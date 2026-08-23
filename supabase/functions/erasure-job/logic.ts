import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// Erasure loop extracted from index.ts so the status transitions are unit-testable
// (deno test): index.ts keeps the transport shell (requireServiceRole, client + auth
// + storage port wiring) and injects everything here (repo convention: DI over mocks).
// Auth and storage arrive as capability ports because the fake db has no .auth or
// .storage namespace. The auth port exposes ONLY signOut — getUserById/deleteUser
// join it when the legal-gated cascade below goes live.

export const CANDIDACY_VIDEOS_BUCKET = 'candidacy-videos';

export type ErasureAuth = {
  /** db.auth.admin.signOut — global revoke, MUST run before any delete (see step 1) */
  signOut: (profileId: string, scope: 'global') => Promise<unknown>;
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
};

/** Row shape of the blob-removal manifest gdpr_erase_fund_footprint returns. */
type ManifestRow = { bucket_id: string; name: string };

export async function processErasureRequests(ctx: ErasureCtx): Promise<Response> {
  const { db, auth, storage } = ctx;

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
    await auth.signOut(erasureReq.profile_id, 'global').catch(() => {
      degraded = true;
    });

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
    //   irreversible work, and calling that a failure misleads whoever reads the row next,
    //   including a retry that assumes nothing happened.
    //   Flip the clean branch to status='done' only when (3-gated) + (4) go live (#107, gated
    //   on #184). Every step above is idempotent, so re-running a request after that flip
    //   finishes cleanly.
  }

  return new Response(JSON.stringify({ seen: reqs?.length ?? 0 }), {
    headers: { 'content-type': 'application/json' },
  });
}
