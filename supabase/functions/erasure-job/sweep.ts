import { z } from 'zod';

/**
 * erasure-job (#573) — the account-wide byte sweep.
 *
 * Until this existed, a GDPR erasure removed one bucket. `gdpr_erase_fund_footprint`
 * (20260815131925) returns a manifest hard-filtered to `candidacy-videos`, erasure-job removed
 * that manifest, and nothing else in the tree ever called `.remove()` on `post-media`,
 * `moments`, `story-segments`, `avatars`, `chat-media` or `exports`. Those bytes outlived the
 * erasure — unreadable through any client policy, and never deleted.
 *
 * WHICH buckets is not decided here. `gdpr_storage_footprint` (20260827110034, service_role-only,
 * pgTAP 0137) holds the list and the `{uid}/` prefix predicate; ./sweep-buckets.test.ts mirrors
 * that list against every bucket the migrations create and against packages/api's
 * `MediaBucketName`, so a new bucket cannot reach `main` unswept. Six already have: at `b203c48`
 * this job has no storage port at all, so every one of the six buckets declared there keeps an
 * erased member's bytes. `chat-media` is not among them — it is on `dev` only — and is simply the
 * bucket whose arrival made the gap visible enough to file (#573). This file is only the loop.
 *
 * Like story-segment-reaper, each round RE-LISTS rather than paginating: a removed object leaves
 * `storage.objects`, so a cursor would skip every other batch (rule 9 is about rows that stay;
 * these do not). Re-listing also carries the only honest completeness check available — the
 * Storage API answering 200 is not proof a byte is gone, and a key that keeps coming back burns
 * the round budget and lands the request on 'failed' instead of on a clean 'partial'.
 */

/** storage-api's ceiling for one `remove()` call, and PostgREST's `max_rows` (config.toml). */
export const REMOVE_BATCH = 1000;

/**
 * Rounds per member. Clean-sweep capacity is `(MAX_ROUNDS - 1) × REMOVE_BATCH` = 5000 objects,
 * NOT `MAX_ROUNDS × REMOVE_BATCH`: `exhausted` is only set by a listing that comes back empty, so
 * one round is always spent confirming rather than removing. Getting that off by one would land a
 * member whose bytes were in fact all deleted on the terminal `'failed'` status, which nothing
 * re-queues.
 *
 * 5000 is a runaway guard, NOT a proven ceiling. Most of what a member stores is bounded — one
 * active dream (PRD §4.3), posts and moments and stories per day — but `chat-media` and `exports`
 * carry no per-day cap in this tree, so a long-lived heavy chat user could in principle exceed it.
 * That direction of failure is the safe one and is why the budget exists at all: the sweep reports
 * `exhausted: false`, the request lands on `'failed'`, and an operator sees an erasure that did
 * not finish. Nothing re-queues a terminal request until #107 lands (logic.ts says so at the
 * status write), so the alternative — a silent clean report over bytes still in the bucket — is
 * the one outcome this must never produce.
 *
 * Deliberately NOT sized against a pg_net window, unlike story-segment-reaper's: nothing schedules
 * this function (no migration names it in a `cron.schedule`; index.ts and
 * docs/RELEASE-RUNBOOK.md §7 both say so), so it is invoked by hand and answers to no timeout but
 * the platform's.
 */
export const MAX_ROUNDS = 6;

/** The bucket-aware Storage surface. index.ts wires `db.storage.from(bucket).remove(paths)`. */
export type SweepStorage = {
  remove: (bucket: string, paths: string[]) => PromiseLike<{ error: unknown }>;
};

export type SweepPorts = {
  /** `db.rpc('gdpr_storage_footprint', { p_profile_id, p_limit })` */
  list: (profileId: string, limit: number) => PromiseLike<{ data: unknown; error: unknown }>;
  remove: SweepStorage['remove'];
};

export type SweepSummary = {
  /**
   * DISTINCT keys handed to a `remove()` that answered without an error. Distinct because a key
   * the API accepted and did not actually delete is re-listed next round and handed over again,
   * and a count that grew each time would read as more work done rather than as the same work
   * repeated — erasure-job reports this number as a health signal, so it must not inflate.
   *
   * Still not a confirmation that each byte is gone: only the next round's listing proves that,
   * which is why `exhausted`, not this number, is what a caller may treat as success.
   */
  removed: number;
  /** List rounds performed. */
  rounds: number;
  /** A round listed nothing: the member's folder is empty in every declared bucket. */
  exhausted: boolean;
  /**
   * The manifest read failed, its rows were malformed, or a `remove()` reported an error either
   * way it can (a rejection, or a resolved `{ error }` — storage-js uses both, #179).
   */
  failed: boolean;
};

const manifestRows = z.array(z.object({ bucket_id: z.string().min(1), name: z.string().min(1) }));

export async function sweepMemberStorage(
  ports: SweepPorts,
  profileId: string,
): Promise<SweepSummary> {
  const summary: SweepSummary = { removed: 0, rounds: 0, exhausted: false, failed: false };
  /** `bucket/name` of every key a remove() accepted, so a re-listed key is counted once. */
  const accepted = new Set<string>();

  while (summary.rounds < MAX_ROUNDS) {
    summary.rounds++;

    const listed = await Promise.resolve(ports.list(profileId, REMOVE_BATCH)).catch(() => ({
      data: null,
      error: new Error('storage manifest rejected'),
    }));
    if (listed.error) {
      summary.failed = true;
      return summary;
    }

    const parsed = manifestRows.safeParse(listed.data ?? []);
    if (!parsed.success) {
      // Malformed rows are a failure, never an empty folder: the two reach this line with the
      // same "nothing to remove" shape and only one of them is a swept member.
      summary.failed = true;
      return summary;
    }

    // Nothing left under the member's prefix in any declared bucket — the only clean end.
    if (parsed.data.length === 0) {
      summary.exhausted = true;
      return summary;
    }

    // One remove() per bucket, because the call is bucket-scoped. The manifest is ordered by
    // bucket_id, so this is at most one call per declared bucket per round.
    const byBucket = new Map<string, string[]>();
    for (const row of parsed.data) {
      const paths = byBucket.get(row.bucket_id);
      if (paths) paths.push(row.name);
      else byBucket.set(row.bucket_id, [row.name]);
    }

    let roundFailed = false;
    for (const [bucket, paths] of byBucket) {
      const removed = await Promise.resolve(ports.remove(bucket, paths)).catch(() => ({
        error: new Error('storage removal rejected'),
      }));
      if (removed.error) {
        // Recorded, and the OTHER buckets in this round are still attempted: a dead bucket must
        // not leave a live one's bytes behind.
        summary.failed = true;
        roundFailed = true;
      } else {
        for (const path of paths) accepted.add(`${bucket}/${path}`);
        summary.removed = accepted.size;
      }
    }
    // A Storage API that errored will not recover inside this invocation, and re-listing would
    // just hand it the same keys four more times. The leftovers re-surface on the next run of
    // the job, derived from storage.objects exactly as this round derived them.
    if (roundFailed) return summary;
  }

  // Rounds ran out with the folder still listing: `exhausted` stays false, which is what the
  // caller degrades on. Never reported as a clean sweep.
  return summary;
}
