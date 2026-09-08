import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { dreamPagePaths, type ErasureKv, ogCardPaths } from './kv.ts';
import { sweepMemberStorage, type SweepStorage } from './sweep.ts';

// Erasure loop extracted from index.ts so the status transitions are unit-testable
// (deno test): index.ts keeps the transport shell (requireServiceRole, client + auth
// + storage port wiring) and injects everything here (repo convention: DI over mocks).
// Auth and storage arrive as capability ports because the fake db has no .auth or
// .storage namespace. Since #107 the auth port carries all three GoTrue calls the
// cascade needs: revokeSessions, getUserById and deleteUser.

export type ErasureAuth = {
  /**
   * Revoke every live session of the subject, BY PROFILE ID — MUST run before any delete (step 1).
   *
   * By id, and no scope argument, because both are the shape of #542: the port used to be
   * `signOut(profileId, 'global')` over `db.auth.admin.signOut`, which takes «A valid, logged-in
   * JWT» and 401'd on every UUID it was handed. Its replacement (./revoke.ts) revokes all of the
   * user's sessions and nothing else, so a scope parameter would be one the implementation
   * cannot honour — the same class of lie the port already told once.
   *
   * Reports failure BOTH ways, like every other Supabase surface: a rejection, and a RESOLVED
   * `{ error }` — the shape PostgREST returns for a failed RPC, and the common one. A caller
   * that only catches would record a run whose sessions are still live as a clean one.
   */
  revokeSessions: (profileId: string) => Promise<{ error?: unknown } | null>;
  /**
   * The subject's auth row, read for ONE field: the email the waitlist is purged by (step 4a).
   * It has to be read before deleteUser — afterwards there is nothing left to read it from —
   * and it is the only place in this job that touches an address.
   *
   * Same two failure shapes as every other port here: a rejection and a resolved `{ error }`.
   */
  getUserById: (
    profileId: string,
  ) => Promise<{ data?: { user?: { email?: string | null } | null } | null; error?: unknown }>;
  /**
   * Delete the auth.users row — the irreversible one. Cascades profiles and, through it, every
   * ON DELETE CASCADE row the member owns. MUST run after the payment tables are pseudonymised:
   * `event_tickets.user_id` and `circle_memberships.profile_id` are themselves ON DELETE CASCADE,
   * so on a profile that still owns them this call DELETES the financial records the controller's
   * ruling retains, rather than merely failing.
   */
  deleteUser: (profileId: string) => Promise<{ error?: unknown } | null>;
};

/**
 * The Stripe surface the cascade needs: cancel the erased member's Circle subscription.
 *
 * Pseudonymising `circle_memberships` hides who the subscriber was; it does not stop Stripe
 * charging them. Without this the erased member keeps being billed monthly for an account that
 * no longer exists, with no portal to cancel from and no row that can be traced back to them —
 * the worst possible combination, and one they cannot fix themselves.
 *
 * A port rather than a direct call so the loop stays testable without a Stripe fixture, and so
 * the secret is resolved in index.ts behind the service-role gate like every other one.
 */
export type ErasureStripe = {
  /**
   * The subscription's current status, or **null when Stripe has no such subscription**.
   *
   * Read before cancelling, because since #717 a torn-down pass is re-driven and the cancel is
   * the one step of the cascade that is not idempotent by construction. It sits BEFORE (3c)
   * nulls `circle_memberships.profile_id`, so an isolate killed between the two leaves the
   * pointer in place and the next pass reaches the same subscription again. What Stripe does
   * with a second cancel is not written down in its API reference, and this file is not the
   * place to guess: the object stays addressable after cancellation («After it's canceled, the
   * subscription is largely immutable. You can still update its metadata and
   * cancellation_details» — docs.stripe.com/api/subscriptions/cancel), so asking is cheap and
   * needs no assumption about an error we have never seen.
   */
  getSubscriptionStatus: (subscriptionId: string) => Promise<string | null>;
  /** Cancel immediately. Stripe emits `customer.subscription.deleted`, which the webhook records. */
  cancelSubscription: (subscriptionId: string) => Promise<unknown>;
};

/**
 * Statuses that mean the billing is already stopped, so a re-driven pass must NOT cancel again.
 * `incomplete_expired` is here with `canceled` because it is the other terminal state: the first
 * invoice never got paid, Stripe closed the subscription itself, and there is nothing left to
 * cancel. Everything else — including `past_due` and `unpaid` — is a subscription that can still
 * charge, and those must be cancelled.
 */
const SETTLED_SUBSCRIPTION_STATUSES = new Set(['canceled', 'incomplete_expired']);

/**
 * The Storage surface the job needs. BUCKET-AWARE since #573: `remove()` is bucket-scoped, and
 * the sweep below reaches every declared bucket, so index.ts can no longer pre-bind one
 * (`db.storage.from('candidacy-videos')` was the whole erasure's storage reach).
 */
export type ErasureStorage = SweepStorage;

export type ErasureCtx = {
  /** service role — owns the request status column and every RPC in the cascade */
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
  /**
   * Cancels the erased member's Circle subscription, or **null when STRIPE_SECRET_KEY is absent
   * from this deployment's env**. Null is carried rather than resolved in the loop for the same
   * reason `kv` is: an unconfigured deployment must be a state the run can RECORD, not a step it
   * skips. Billing that outlives an erasure is not something to discover from a chargeback.
   */
  stripe: ErasureStripe | null;
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

/**
 * How many requests one pass claims.
 *
 * Passed to `claim_erasure_requests` rather than left to its default: the batch size is this
 * loop's business — it bounds how much irreversible work one invocation attempts inside the
 * edge-function wall clock — while the LEASE is the table's, and is deliberately NOT passed.
 * Duplicating the lease here would put the number an operator reads in the migration out of step
 * with the one that runs, and the parameter exists so RELEASE-RUNBOOK §7.5 can override it for a
 * hand-driven pass, not so this file can restate it.
 */
const CLAIM_BATCH = 20;

export async function processErasureRequests(ctx: ErasureCtx): Promise<Response> {
  const { db, auth, storage, kv, stripe } = ctx;

  // Reported whatever happens below, including on a zero-request run: a smoke invocation of
  // this function is then enough to see that the deployment cannot purge (#515).
  let kvDeleted = 0;
  let kvFailed = 0;
  /** Keys the Storage API accepted across every bucket and every request in this run (#573). */
  let storageRemoved = 0;
  /**
   * Requests whose account was deliberately NOT deleted because the run left something behind
   * (#107). Reported because `seen` and a 200 cannot tell an operator apart from a pass that
   * erased everybody: a project missing the CF_KV trio answers 200 with `seen: 5` and erases
   * nobody, and R-8's flip condition is «a 200» — this is the number that makes it checkable.
   */
  let retained = 0;

  // ATOMIC LEASE CLAIM (#717) — one statement, in the database, flips the rows to 'processing'
  // and stamps `claimed_at`. What it replaced was a SELECT on `status = 'requested'` followed by
  // an UPDATE carrying no predicate at all, which had two holes: a pass torn down between them
  // stranded the row on 'processing' with nothing left to re-queue it, and two overlapping passes
  // both selected the same twenty rows and both drove the whole cascade.
  //
  // The claim is an RPC rather than a PostgREST filter chain because it is a BATCH — the
  // conditional UPDATE ... RETURNING that decides the winner cannot be expressed here — and
  // because de-duplicating by member needs a DISTINCT ON that PostgREST has no spelling for.
  // 20260908130546 carries the predicate and pgTAP (0058) proves it; the assertions below are
  // this loop's half of the contract, which is that it asks for the batch and writes no status
  // of its own until the terminal one.
  const { data: reqs, error } = await db.rpc('claim_erasure_requests', { p_limit: CLAIM_BATCH });
  if (error) return new Response(error.message, { status: 500 });

  for (const erasureReq of (reqs ?? []) as { id: string; profile_id: string | null }[]) {
    // The subject. Two open requests for one member can no longer be driven together: the claim
    // returns at most one row per member per pass, and holds the member's other rows back while
    // the lease on this one is live. That matters more than it used to — 20260908085513's unique
    // index is PARTIAL on `status = 'requested'`, so a stranded 'processing' row never stopped
    // the member filing a second request beside it.
    //
    // Cast because `returns table (id uuid, profile_id uuid)` generates a non-null `profile_id`
    // (Supabase's generator cannot see that a RETURNING column is nullable), and the column IS
    // nullable since 20260908073545 — the branch below is live, not dead code.
    const profileId = erasureReq.profile_id;

    // A request whose subject is already gone — reachable through the R-8 §7.5 reconcile, which
    // re-queues rows written before #107, and whose `profile_id` the account cascade has since
    // SET NULL (20260908073545). The account is gone, so the request is met.
    if (!profileId) {
      await db.from('gdpr_erasure_requests').update({ status: 'done' }).eq('id', erasureReq.id);
      continue;
    }

    // #515 — every step below is best-effort so one dead dependency cannot stall the batch, but
    // «swallowed» must not mean «unrecorded»: a step that errored is what separates the terminal
    // 'failed' from 'done'. 'done' claims the request is fulfilled; that claim is only true while
    // this stays false.
    let degraded = false;
    // #107 — a SECOND flag, and it is not a duplicate of `degraded`. `degraded` decides what the
    // row says afterwards; this decides whether the rest of the cascade may run at all, and the
    // difference is destructive. `event_tickets.user_id` and `circle_memberships.profile_id` are
    // ON DELETE CASCADE, so deleting the account before (3c) has nulled them does not fail — it
    // silently DELETES the financial records the controller's ruling retains for ten years.
    //
    // It is cleared by the fund reach failing, and it stops (3b-bis)/(3c)/(3d) as well as (4).
    // Running the money steps after the fund reach failed was its own defect: it left a LIVE,
    // re-signable account whose tickets no longer scan and whose Circle subscription is still
    // billing, which is worse than either finishing or stopping.
    let cascadeSafe = true;

    // (1) revoke sessions before deleting — deleting a user does not invalidate live tokens [SKILL].
    //     Both failure shapes count: a rejection, and the resolved { error } the RPC returns for
    //     a failed statement. Leaving the member's tokens live is the last thing that may pass
    //     for a clean run — and until #542 it did, on every request that took this path.
    //     Revoking nothing is NOT a failure: a member who was never signed in on any device has
    //     no session to revoke, and ./revoke.ts reports that as success (a count, not an error).
    const revokeResult = await auth
      .revokeSessions(profileId)
      .catch((e: unknown) => ({ error: e ?? new Error('session revoke rejected') }));
    if (revokeResult?.error) degraded = true;

    // (3) fund-table reach — LIVE (#240). One atomic DB transaction (gdpr_erase_fund_footprint,
    //     20260815131925): fund_contributions tombstone-reassigned to the pre-seeded no-PII
    //     sentinel (D50: money rows are pseudonymized, never deleted — and #378's ON DELETE
    //     RESTRICT makes the reassignment mandatory before (4b) can ever run), candidacy_votes
    //     + dream_candidacies deleted, touched fund_aggregates recomputed. The function returns
    //     the candidacy-videos blob manifest — which this loop no longer removes from, see (3a).
    //
    //     Its `data` is deliberately not read. Since #573 the sweep below derives the same rows
    //     from the same table for EVERY declared bucket, so the fund manifest is a strict subset
    //     of what (3a) already removes and consuming it here would be one dead Storage round trip
    //     per request. The RPC's return shape stays as it is: 20260815131925 is applied,
    //     migrations are append-only, and 0104 pins that manifest as the fund reach's own
    //     contract.
    const { error: fundError } = await db.rpc('gdpr_erase_fund_footprint', {
      p_profile_id: profileId,
    });
    if (fundError) {
      degraded = true; // nothing irreversible ran for this request — that is a real failure
      // fund_contributions.profile_id is ON DELETE RESTRICT (#378), so (4b) would fail anyway —
      // but say it here rather than leave it to be discovered as a 23503.
      cascadeSafe = false;
    } else {
      // (3a) BYTES — every bucket, not just candidacy-videos (#573). gdpr_storage_footprint
      //     (20260827110034) lists the member's `{uid}/` folder across all seven declared
      //     buckets; ./sweep.ts removes it in re-listing rounds. Rejection and resolved
      //     `{ error }` are both swallowed and both recorded, like the session revoke: one dead
      //     Storage call must not stall the batch, but a member's photo still sitting in a
      //     bucket means this run did not finish what it started, so it is 'failed', never
      //     'partial'. Rounds running out without the folder draining counts the same way.
      //
      //     Gated on the fund reach succeeding, as the candidacy removal was — but the reason is
      //     narrower than it looks, and is written down here so nobody "fixes" the asymmetry
      //     later. For candidacy-videos the gate buys consistency outright: the same transaction
      //     deletes the dream_candidacies rows whose video_url names those keys, so the rows and
      //     their bytes go together or neither goes. For the other six buckets it buys nothing of
      //     the kind — it only decides whether the bytes go a few milliseconds before their rows
      //     or not at all.
      //
      //     Since #107 the seam this used to leave is closed on a clean run: (4b) below deletes
      //     the account in the same pass, so the rows that pointed at these bytes go too. It is
      //     still visible on a DEGRADED run — bytes gone, rows kept, dead signed URLs on other
      //     members' feeds — and that trade stays deliberate. Art. 17 is about the bytes: a broken
      //     image on someone else's feed is a rendering defect, an erased member's photograph
      //     still sitting in a bucket is the compliance failure #573 was filed for. Do NOT close
      //     it by narrowing the sweep.
      const sweep = await sweepMemberStorage(
        {
          list: (pid, limit) =>
            db.rpc('gdpr_storage_footprint', { p_profile_id: pid, p_limit: limit }),
          remove: storage.remove,
        },
        profileId,
      );
      if (sweep.failed || !sweep.exhausted) degraded = true;
      storageRemoved += sweep.removed;
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
    //     dreams rows with it — so a purge attempted after it would have no key input at all.
    //     Since #107 that delete happens in this same pass, so the ordering is load-bearing
    //     rather than merely careful.
    //
    //     One sweep, not two: purgePaths lists the whole namespace per call, so handing it the
    //     handle paths and the dream paths together costs one listing instead of two.
    const [{ data: profile, error: profileError }, { data: dreamRows, error: dreamsError }] =
      await Promise.all([
        db.from('profiles').select('handle').eq('id', profileId).maybeSingle(),
        // Deliberately unfiltered: NOT `status = 'active'`, NOT `deleted_at is null`. Those
        // filters describe what the page serves TODAY, and this is about what KV cached
        // YESTERDAY. A dream that was public and is now archived, soft-deleted or hidden by a
        // facet flip still has a stranded entry under a dead build prefix, holding the text
        // verbatim — un-publishing a page has never deleted its cached copy (rules/web.md).
        db
          .from('dreams')
          .select('id')
          .eq('profile_id', profileId)
          // Ordered so the page is deterministic, bounded so a truncated one is detectable.
          .order('id', { ascending: true })
          .limit(DREAM_ID_READ_LIMIT),
      ]);
    const handle = (profile as { handle?: string | null } | null)?.handle ?? null;
    const dreamRowCount = ((dreamRows ?? []) as unknown[]).length;
    const dreamIds = ((dreamRows ?? []) as { id?: string | null }[])
      .map((row) => row.id)
      .filter((id): id is string => !!id);

    // `kvPaths`, not `paths`: these are cache keys, and the run also deals in a second list of
    // strings — ./sweep.ts's storage keys. Two different lists of strings under one name is how
    // the wrong one gets handed to the wrong call, so they stay named apart even now that the
    // storage half has moved out of this function.
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
      // The RAW row count, not `dreamIds`: the filter above drops a row with no id, and a full
      // page holding one would otherwise leave 499 and slip past this guard — a truncated read
      // reading as a complete one, which is the shape this guard exists to close.
      if (dreamRowCount >= DREAM_ID_READ_LIMIT) {
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

    if (!cascadeSafe) {
      // The fund reach failed, so nothing below may run. Skipping (3c)/(3d) is not tidiness:
      // pseudonymising the money and releasing the references on an account that then STAYS
      // (because (4) is skipped too) leaves a live, re-signable member whose tickets no longer
      // scan and whose Circle subscription is still billing. Half-erasing a member who is still
      // here is worse than either finishing or stopping.
      console.error('erasure-job: cascade halted before the money steps', erasureReq.id);
    } else {
      // (3b-bis) STOP THE BILLING, before anything hides who was being billed.
      //     Pseudonymising `circle_memberships` removes our record of the subscriber; it does
      //     nothing whatever to Stripe, which goes on charging the card monthly for an account
      //     that no longer exists, with no portal to cancel from and no row left that points at
      //     the person. So the cancellation goes FIRST — before (3c) nulls `profile_id`, and long
      //     before (4b) — and Stripe's own `customer.subscription.deleted` writes the outcome
      //     back through the webhook, which is the only writer of money state (rule 6).
      //
      //     Read from the row rather than from Stripe: `stripe_subscription_id` is the cache of
      //     the id we were given, and if it is absent there is nothing to cancel.
      const { data: subRow, error: subReadError } = await db
        .from('circle_memberships')
        .select('stripe_subscription_id')
        .eq('profile_id', profileId)
        .maybeSingle();
      const subscriptionId =
        (subRow as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id ??
        null;
      if (subReadError) {
        // Unread is not «no subscription». Carrying on would pseudonymise the row and lose the
        // only pointer to the thing still taking the member's money.
        degraded = true;
        cascadeSafe = false;
        console.error('erasure-job: membership unreadable, billing not stopped', erasureReq.id);
      } else if (subscriptionId) {
        if (!stripe) {
          // Same doctrine as the KV trio: unconfigured is a state to REPORT, never a step to
          // skip. A deployment with no STRIPE_SECRET_KEY cannot stop the billing, and finishing
          // the erasure anyway would leave a charge nobody can trace or refund.
          degraded = true;
          cascadeSafe = false;
          console.error(
            'erasure-job: Stripe unconfigured, subscription not cancelled',
            erasureReq.id,
          );
        } else {
          // ASK FIRST (#717). This step is the one part of the cascade that is not idempotent by
          // construction, and since the lease re-drives a torn-down pass it has to become so.
          // The window is narrow and real: the cancel runs BEFORE (3c) nulls
          // `circle_memberships.profile_id`, so an isolate killed between them leaves the row
          // still pointing at a subscription this pass already cancelled, and the next pass
          // reads the same pointer. Cancelling twice would then turn a stranded request into a
          // permanently failing one — `cascadeSafe = false` on every subsequent pass — which is
          // strictly worse than the bug the lease was added to fix.
          //
          // A status we could not READ is not «already cancelled»: it is treated exactly like a
          // failed cancel, because carrying on would pseudonymise the row and lose the only
          // pointer to the thing still taking the member's money.
          const status = await stripe
            .getSubscriptionStatus(subscriptionId)
            .then((s) => ({ status: s, error: null as unknown }))
            .catch((e: unknown) => ({ status: null, error: e ?? new Error('status read failed') }));
          if (status.error) {
            degraded = true;
            cascadeSafe = false;
            console.error(
              'erasure-job: subscription status unreadable, billing not stopped',
              erasureReq.id,
              status.error,
            );
          } else if (status.status !== null && SETTLED_SUBSCRIPTION_STATUSES.has(status.status)) {
            // Already stopped — by an earlier pass of this same request, by the member through
            // the portal, or by Stripe itself when the first invoice never settled. Nothing to
            // do, and NOT a degradation: the obligation this step exists for is met.
          } else {
            // `status.status === null` lands here too, and deliberately: Stripe not knowing the
            // id is a state we have never observed, and attempting the cancel makes it visible
            // as an error on the row rather than passing silently for «already gone».
            const cancelled = await stripe
              .cancelSubscription(subscriptionId)
              .then(() => null)
              .catch((e: unknown) => e);
            if (cancelled) {
              degraded = true;
              cascadeSafe = false;
              console.error('erasure-job: subscription cancel failed', erasureReq.id, cancelled);
            }
          }
        }
      }
    }

    if (cascadeSafe) {
      // (3c) the retained payment tables — LIVE since #107, implementing the controller's
      //     2026-09-07 ruling (#184's closing comment): event_tickets and circle_memberships are
      //     PSEUDONYMISED, never deleted. gdpr_erase_payment_footprint (20260908071656) nulls the
      //     identity (and the ticket's qr_token, a bearer credential rather than a money fact),
      //     stamps erased_at, and keeps every amount, Stripe id and timestamp.
      //
      //     Why this must run BEFORE (4b) rather than being merely tidy: both identity columns
      //     are ON DELETE CASCADE, so deleting the account first does not raise — it deletes the
      //     financial records the ruling retains for ten years.
      //
      //     Chat is NOT on this list, by design: conversations.participant_a/b are ON DELETE
      //     CASCADE, so (4b) erases the member's conversations and their messages outright, and
      //     messages.sender_id's SET NULL no longer aborts that cascade (#336, 20260813163902).
      //     The ruling confirmed it — counterpart conversations are not preserved.
      const { error: paymentError } = await db.rpc('gdpr_erase_payment_footprint', {
        p_profile_id: profileId,
      });
      if (paymentError) {
        degraded = true;
        cascadeSafe = false;
        console.error('erasure-job: payment pseudonymisation failed', erasureReq.id, paymentError);
      }

      // (3d) the references that make (4b) raise 23503, and the one that makes it DESTROY.
      //     gdpr_release_profile_references reassigns event_attendance.scanned_by and
      //     audit_log.actor_id to the tombstone sentinel, disowns and soft-deletes the member's
      //     events — `events.organizer_id` is ON DELETE CASCADE and `event_tickets`, `rsvps` and
      //     `event_attendance` all hang off `events`, so an organiser's account delete would
      //     otherwise hard-delete every ticket every OTHER member bought from them
      //     (20260908084858) — and deletes the member's invites. Without it, `done` is
      //     unreachable for anyone who ever ran an event or moderated a report.
      const { error: refError } = await db.rpc('gdpr_release_profile_references', {
        p_profile_id: profileId,
      });
      if (refError) {
        degraded = true;
        cascadeSafe = false;
        console.error('erasure-job: reference release failed', erasureReq.id, refError);
      }
    }

    // (4) runs only on a run with NOTHING left behind — `degraded` included, not just
    //     `cascadeSafe`. That is wider than it first looks and it is deliberate: the storage
    //     sweep and the KV purge both key on the member's uid, and (4b) SET NULLs the uid off
    //     this very request row (20260908073545). Deleting the account after a failed sweep
    //     therefore destroys the only handle that could ever find the bytes again — the request
    //     is left saying 'failed' with no subject, and the R-8 §7.5 re-drive can only mark it
    //     'done' over residue nobody can locate. Leaving the account standing one more night is
    //     recoverable; deleting the map is not.
    if (!cascadeSafe || degraded) {
      retained++;
      console.error(
        'erasure-job: account deletion skipped, the run left something behind',
        erasureReq.id,
      );
    } else {
      // (4a) purge the waitlist by the erased member's email — read from auth.users while it
      //     still exists. Ordering with (4b) is the whole point: after the delete there is no
      //     address left to match on. The 540-day default purge (purge_email_waitlist) still
      //     stands for everyone else; this is the on-request half of the ruling's item 5.
      //
      //     A failure here blocks (4b), for the same reason a failed sweep does: the address is
      //     matched from `auth.users`, and (4b) is what removes it. Delete first and the waitlist
      //     row becomes unfindable — an address we were asked to erase, kept, with nothing left
      //     to match it against.
      const authUser = await auth.getUserById(profileId).catch((e) => ({ data: null, error: e }));
      if (authUser?.error) {
        degraded = true;
        console.error('erasure-job: auth user unreadable, waitlist not purged', erasureReq.id);
      } else {
        const email = authUser?.data?.user?.email ?? null;
        if (email) {
          // Through an RPC, not a PostgREST filter. The match has to fold case, because
          // `athanor.purge_email_waitlist` does (20260620140149:111) and a row stored as
          // `Ada@X.test` is the same entry as the `ada@x.test` GoTrue returns — so `.eq` walks
          // past it. But `.ilike` cannot be made safe here: **PostgREST rewrites `*` to `%` in a
          // pattern before Postgres sees it**, with no escape at that layer, and `*` is legal in
          // a local part. Verified against staging — `ilike.a*b@probe.test` returned
          // `axb@probe.test` too. Erasing one member would have deleted another member's row.
          // `gdpr_purge_waitlist_email` (20260908092809) is an equality on `lower()` with no
          // pattern language anywhere in it.
          const { error: waitlistError } = await db.rpc('gdpr_purge_waitlist_email', {
            p_email: email,
          });
          if (waitlistError) {
            degraded = true;
            console.error('erasure-job: waitlist purge failed', erasureReq.id, waitlistError);
          }
        }
      }

      // (4b) the irreversible one: delete auth.users, which cascades profiles and with it every
      //     ON DELETE CASCADE row the member owns — dreams, posts, moments, conversations, the
      //     profile itself. Everything above exists so that this line destroys only what the
      //     ruling says to destroy — and the `degraded` re-check is what keeps (4a)'s own
      //     failure from being overtaken by it.
      if (!degraded) {
        const deleteResult = await auth.deleteUser(profileId).catch((e: unknown) => ({ error: e }));
        if (deleteResult?.error) {
          degraded = true;
          console.error('erasure-job: account delete failed', erasureReq.id, deleteResult.error);
        }
      }
    }

    await db
      .from('gdpr_erasure_requests')
      .update({ status: degraded ? 'failed' : 'done' })
      .eq('id', erasureReq.id);
    // ^ 'done' since #107: a clean pass revokes the sessions, pseudonymises the retained money
    //   rows, deletes the bytes, purges the cache and deletes the account, which is the whole of
    //   what Article 17 asks. 'failed' means a step actually failed (#515) — including a
    //   deliberate skip of (4) above, because an account that still exists is an unmet
    //   obligation however good the reason.
    //
    //   'partial' stays in the CHECK and is no longer written by this job. It was the honest
    //   label while the cascade stopped at a legal gate that no longer exists; the rows that
    //   carry it are historical and are re-driven by the R-8 procedure, not by this loop. Note
    //   what no terminal status buys: the claim predicate reaches 'requested' and stale
    //   'processing' and nothing else, so a TERMINAL row is still never re-queued on its own —
    //   what #717's lease added is the recovery of a row torn down mid-cascade, not of one this
    //   loop decided about. Re-driving a terminal row by hand — flip it back to 'requested' —
    //   still finishes cleanly: the DB reach is idempotent by construction, the account delete
    //   cannot run twice because (4b) SET NULLs this row's subject, and the Stripe cancel asks
    //   for the subscription's status before touching it (#717).
  }

  return new Response(
    JSON.stringify({
      seen: reqs?.length ?? 0,
      // `configured: false` is the whole point of reporting this: it is true of the
      // deployment, not of a request, so it shows up even on a run that saw nothing (#515).
      kvPurge: { configured: kv !== null, deleted: kvDeleted, failed: kvFailed },
      // #107 — non-zero means at least one member is still here on purpose. On a healthy
      // project this is 0 and `seen` is the number erased.
      retained,
      // #573 — bytes, across every declared bucket. A run that erased members and reports
      // `removed: 0` is the shape of the bug this replaced: the sweep found nothing where the
      // member's photos should have been.
      storageRemoved,
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}
