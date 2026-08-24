import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { dreamPagePaths, type ErasureKv, ogCardPaths } from './kv.ts';

// Erasure loop extracted from index.ts so the status transitions are unit-testable
// (deno test): index.ts keeps the transport shell (requireServiceRole, client + auth
// + storage port wiring) and injects everything here (repo convention: DI over mocks).
// Auth and storage arrive as capability ports because the fake db has no .auth or
// .storage namespace. The auth port exposes ONLY signOut — getUserById/deleteUser
// join it when the legal-gated cascade below goes live.

export const CANDIDACY_VIDEOS_BUCKET = 'candidacy-videos';

export type ErasureAuth = {
  /**
   * db.auth.admin.signOut — global revoke, MUST run before any delete (see step 1).
   *
   * Reports failure BOTH ways, like every other Supabase surface: GoTrueAdminApi.signOut
   * catches an AuthError and RESOLVES with `{ error }`, rethrowing only non-auth errors. A
   * 4xx/5xx from GoTrue — the common failure — therefore never rejects, so a caller that only
   * catches would record a run whose sessions are still live as a clean one.
   */
  signOut: (profileId: string, scope: 'global') => Promise<{ error?: unknown } | null>;
};

/** The candidacy-videos bucket surface the job needs — index wires db.storage.from(...). */
export type ErasureStorage = {
  remove: (paths: string[]) => Promise<{ error: unknown }>;
};

export type ErasureCtx = {
  /** service role — owns the request status column (+ the gated cascade, when live) */
  db: SupabaseClient;
  auth: ErasureAuth;
  storage: ErasureStorage;
  /**
   * Cloudflare KV purge of the subject's cached public pages (#515 item 3), or **null when
   * the CF_KV_* trio is absent from edge-function env**. Null is carried this far rather than
   * resolved inside the loop so the unconfigured state is a value the loop can record: an
   * unconfigured deployment leaves the erased member's card and page readable by key, which
   * is the one thing #468/#492 say must never be a silent skip.
   */
  kv: ErasureKv | null;
};

/**
 * How many of the subject's dream ids one run derives KV keys for.
 *
 * Bounded because PostgREST caps a response at `max_rows` (supabase/config.toml) and returns
 * the truncated page with NO error — an unbounded read would drop the tail silently and this
 * block would report a clean sweep over a partial key set, which is the one thing it exists to
 * prevent. Far above any real member (PRD §4.3 allows one active dream, and editing updates in
 * place rather than archiving), so hitting it means something is wrong; a full page is
 * therefore treated as a purge gap rather than as a complete read.
 */
const DREAM_ID_READ_LIMIT = 500;

/** Row shape of the blob-removal manifest gdpr_erase_fund_footprint returns. */
type ManifestRow = { bucket_id: string; name: string };

export async function processErasureRequests(ctx: ErasureCtx): Promise<Response> {
  const { db, auth, storage, kv } = ctx;

  // Reported whatever happens below, including on a zero-request run: a smoke invocation of
  // this function is then enough to see that the deployment cannot purge (#515).
  let kvDeleted = 0;
  let kvFailed = 0;

  const { data: reqs, error } = await db
    .from('gdpr_erasure_requests')
    .select('id, profile_id')
    .eq('status', 'requested')
    .limit(20);
  if (error) return new Response(error.message, { status: 500 });

  for (const erasureReq of reqs ?? []) {
    await db.from('gdpr_erasure_requests').update({ status: 'processing' }).eq('id', erasureReq.id);

    // #515 — every step below is best-effort so one dead dependency cannot stall the batch, but
    // «swallowed» must not mean «unrecorded»: a step that errored is what separates the terminal
    // 'failed' from 'partial'. 'partial' claims the run did everything it could and stopped only
    // at the legal gate; that claim is only true while this stays false.
    let degraded = false;

    // (1) revoke sessions before deleting — deleting a user does not invalidate live tokens [SKILL].
    //     Both failure shapes count: a rejection, and the resolved { error } GoTrue actually
    //     returns for a 4xx/5xx. Leaving the member's tokens live is the last thing that may
    //     pass for a clean run.
    const signOutResult = await auth
      .signOut(erasureReq.profile_id, 'global')
      .catch(() => ({ error: new Error('signOut rejected') }));
    if (signOutResult?.error) degraded = true;

    // (3) fund-table reach — LIVE (#240). One atomic DB transaction (gdpr_erase_fund_footprint,
    //     20260815131925): fund_contributions tombstone-reassigned to the pre-seeded no-PII
    //     sentinel (D50: money rows are pseudonymized, never deleted — and #378's ON DELETE
    //     RESTRICT makes the reassignment mandatory before (4b) can ever run), candidacy_votes
    //     + dream_candidacies deleted, touched fund_aggregates recomputed. The function returns
    //     the candidacy-videos blob manifest, derived from storage.objects rather than the path
    //     convention, so a failed removal here is retried from what actually remains in the
    //     bucket — no orphaned video object survives a crash between the two halves.
    const { data: manifest, error: fundError } = await db.rpc('gdpr_erase_fund_footprint', {
      p_profile_id: erasureReq.profile_id,
    });
    if (fundError) {
      degraded = true; // nothing irreversible ran for this request — that is a real failure
    } else {
      const paths = ((manifest ?? []) as ManifestRow[]).map((row) => row.name);
      // Rejection swallowed like signOut: leftover blobs re-surface in the next manifest,
      // and one dead Storage call must not stall the rest of the batch. Recorded, though —
      // a video still sitting in the bucket means this run did not finish what it started.
      if (paths.length > 0) {
        const { error: removeError } = await storage
          .remove(paths)
          .catch(() => ({ error: new Error('storage removal rejected') }));
        if (removeError) degraded = true;
      }
    }

    // (3b) purge the subject's cached public web pages from Cloudflare KV (#515 item 3, widened
    //     to dreams by #159). apps/web caches the prerendered profile page, its OG card and —
    //     since #159 — every `/dream/{id}` page it has served, and a deploy strands rather than
    //     replaces them, so those bytes outlive every row erased above
    //     (docs/RELEASE-RUNBOOK.md §7.4 — "has to sweep the namespace by prefix"). ./kv.ts
    //     does the sweep; this decides what its outcome means for the record.
    //
    //     Ordering: BOTH key inputs are read HERE, before (4b) below. The keys are hashes of
    //     /@handle and /dream/<id>, and (4b) cascades the profiles row away — which takes the
    //     dreams rows with it — so once the legal gate opens, a purge attempted after it has
    //     no key input left at all.
    //
    //     One sweep, not two: purgePaths lists the whole namespace per call, so handing it the
    //     handle paths and the dream paths together costs one listing instead of two.
    const [{ data: profile, error: profileError }, { data: dreamRows, error: dreamsError }] =
      await Promise.all([
        db.from('profiles').select('handle').eq('id', erasureReq.profile_id).maybeSingle(),
        // Deliberately unfiltered: NOT `status = 'active'`, NOT `deleted_at is null`. Those
        // filters describe what the page serves TODAY, and this is about what KV cached
        // YESTERDAY. A dream that was public and is now archived, soft-deleted or hidden by a
        // facet flip still has a stranded entry under a dead build prefix, holding the text
        // verbatim — un-publishing a page has never deleted its cached copy (rules/web.md).
        db
          .from('dreams')
          .select('id')
          .eq('profile_id', erasureReq.profile_id)
          // Ordered so the page is deterministic, bounded so a truncated one is detectable.
          .order('id', { ascending: true })
          .limit(DREAM_ID_READ_LIMIT),
      ]);
    const handle = (profile as { handle?: string | null } | null)?.handle ?? null;
    const dreamIds = ((dreamRows ?? []) as { id?: string | null }[])
      .map((row) => row.id)
      .filter((id): id is string => !!id);

    // `kvPaths`, not `paths`: the fund branch above binds its own `paths` (the blob manifest),
    // and two different lists of strings under one name in one loop body is how the wrong one
    // gets handed to the wrong call.
    const kvPaths: string[] = [];
    // A key input we could not READ is not one that never existed: the subject's pages may well
    // be sitting in KV, and without the handle or the ids there is no key to derive. Same gap as
    // a failed purge, so each is counted and named as one rather than falling into the
    // nothing-to-purge branch below and reporting a clean sweep.
    if (profileError) {
      degraded = true;
      kvFailed++;
      console.error(
        'erasure-job: handle unreadable, KV purge skipped',
        erasureReq.id,
        profileError,
      );
    } else if (handle) {
      kvPaths.push(...ogCardPaths(handle));
    }
    if (dreamsError) {
      degraded = true;
      kvFailed++;
      console.error(
        'erasure-job: dreams unreadable, KV purge of dream pages skipped',
        erasureReq.id,
        dreamsError,
      );
    } else {
      kvPaths.push(...dreamPagePaths(dreamIds));
      if (dreamIds.length >= DREAM_ID_READ_LIMIT) {
        // A full page may be a truncated one, and PostgREST does not say which. The keys we
        // did derive are still purged below — this records that the READ may have missed some,
        // exactly as an unreadable handle does, so the run cannot report a clean sweep.
        degraded = true;
        kvFailed++;
        console.error(
          'erasure-job: dream id read hit its limit, some dream pages may be unpurged',
          erasureReq.id,
        );
      }
    }

    if (kvPaths.length > 0) {
      if (!kv) {
        // #468/#492: unconfigured is a state to report, not a step to skip. The trio is
        // CF_KV_PURGE_TOKEN / CF_KV_ACCOUNT_ID / CF_KV_NAMESPACE_ID in edge-function env.
        // 'partial' claims the run did everything it could; with the member's card still
        // servable from KV that claim is false, so this is a real 'failed'.
        degraded = true;
        kvFailed++;
        console.error(
          'erasure-job: KV purge unconfigured, cached pages left in place',
          erasureReq.id,
        );
      } else {
        const purge = await kv
          .purgePaths(kvPaths)
          .catch((e) => ({ deleted: 0, scanned: 0, error: e }));
        kvDeleted += purge.deleted;
        // deleted === 0 is NOT a failure: #335 caps prerendering to PRERENDER_HANDLE_LIMIT
        // handles and dream pages prerender not at all, so most members never had a cached
        // entry under any of these paths. Only a broken sweep counts.
        if (purge.error) {
          degraded = true;
          kvFailed++;
          // Recorded, not rethrown: the DB erasure above already ran and is irreversible, so
          // failing the whole batch here would mask a completed cascade behind a KV outage.
          console.error('erasure-job: KV purge failed', erasureReq.id, purge.error);
        }
      }
    }
    // The remaining case — both reads succeeded, no handle and no dreams — is genuinely clean:
    // the member never had a public URL, so nothing was ever cached under one.

    // (3-gated) TODO(legal-gate): the remaining pseudonymize-before-(4) tables — confirm the
    //     retention window with counsel (#184; 10 §5 line 383, same gate as the fund PRD §13 Q1).
    //     Do NOT proceed to (4) while any of these still points at the profile:
    //       event_tickets       — user_id FK (NOT profile_id — 20260615232924)
    //       circle_memberships  — profile_id FK
    //     Chat is NOT on this list by design: conversations.participant_a/b are ON DELETE
    //     CASCADE, so (4b) erases the member's conversations and their messages outright;
    //     messages.sender_id's SET NULL no longer aborts that cascade since the
    //     messages_user_shape widening (#336, 20260813163902). If counsel instead decides
    //     to preserve counterpart conversations, that becomes a schema change here.
    //     The retention window itself is deliberately not encoded anywhere yet — nothing in
    //     this job deletes a retained money row, so there is no number to invent (#184).

    // (2)+(4) DEPLOY-GATED: delete auth.users (cascades profiles + on-delete-cascade content), then
    //     purge waitlist by email. Left commented until the legal gate clears so a stray run can't hard-delete.
    //
    // Step (4a) — purge waitlist by the erased user's email (fetch from auth.users before deletion):
    // const { data: authUser } = await db.auth.admin.getUserById(erasureReq.profile_id);
    // if (authUser?.user?.email) {
    //   await db.from('email_waitlist').delete().eq('email', authUser.user.email);
    // }
    //
    // Step (4b) — delete auth.users row; cascades → profiles → all FK on-delete-cascade content:
    // await db.auth.admin.deleteUser(erasureReq.profile_id);

    await db
      .from('gdpr_erasure_requests')
      .update({ status: degraded ? 'failed' : 'partial' })
      .eq('id', erasureReq.id);
    // ^ never 'done' while legal-gated: the fund reach above ran, but the account itself is NOT
    //   erased, and 'done' would report a partial erasure as complete. It is not 'failed'
    //   either unless something actually failed (#515) — the run below the gate did real,
    //   irreversible work, and calling that a failure misleads whoever reads the row next.
    //   Note what neither status buys: the claim query filters status='requested', so a
    //   terminal row is never picked up again. Every step here is idempotent, but nothing
    //   re-queues a 'failed' one — re-driving it is a manual act until #107 lands.
    //   Flip the clean branch to status='done' only when (3-gated) + (4) go live (#107, gated
    //   on #184). Every step above is idempotent, so re-running a request after that flip
    //   finishes cleanly.
  }

  return new Response(
    JSON.stringify({
      seen: reqs?.length ?? 0,
      // `configured: false` is the whole point of reporting this: it is true of the
      // deployment, not of a request, so it shows up even on a run that saw nothing (#515).
      kvPurge: { configured: kv !== null, deleted: kvDeleted, failed: kvFailed },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}
