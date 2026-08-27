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
 * `MediaBucketName`, so a new bucket cannot reach main unswept the way `chat-media` did. This
 * file is only the loop.
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
 * Rounds per member — 5 × 1000 objects. A member with more than 5000 stored objects does not
 * exist (PRD §4.3 allows one active dream; posts, moments and stories are all bounded per day),
 * so hitting the cap means the sweep is not converging, which is exactly the case that must NOT
 * report clean. Sized like the reaper's, for the same 30 s pg_net answer window.
 */
export const MAX_ROUNDS = 5;

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
   * Keys handed to a `remove()` that answered without an error. NOT a confirmation that each
   * byte is gone — only the next round's listing proves that, which is why `exhausted` and not
   * this number is what a caller may treat as success.
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
        summary.removed += paths.length;
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
