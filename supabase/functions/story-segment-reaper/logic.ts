import { z } from 'zod';
import { json } from '../_shared/respond.ts';

/**
 * story-segment-reaper (#31) — the byte-side half of the nightly story prune.
 *
 * `20260809151111_story_segment_storage_expiry.sql` hides an expired or soft-deleted segment's
 * object behind the storage SELECT policy; `prune_expired_story_segments()` soft-deletes the
 * rows. Neither frees the bytes. This loop does, and it does it through the Storage API only:
 * deleting `storage.objects` rows in SQL leaves the physical file behind ("inaccessible, but
 * you'll still be billed for it" — supabase.com/docs/guides/storage/schema/design), which is
 * the same reason erasure-job removes candidacy videos through `storage.from().remove()`.
 *
 * WHAT gets reaped is not decided here. `story_segment_reap_candidates` (service_role-only,
 * pgTAP 0126) lists objects in the bucket with no descriptor row that was live or pinned
 * within the last hour — the SELECT policy's descriptor predicate inverted, with a grace
 * margin (its viewer-side arms — owner folder, blocks, bans — are about who may read, not
 * whether the segment is alive, and are deliberately not mirrored). So a pinned, undeleted
 * step is never a candidate, an in-flight upload (a row whose upload is still running, or an
 * object younger than the grace) is never a candidate, and the hourly staging refresh that
 * revives seeded rows in place always wins against a nightly pass. This file is only the loop.
 *
 * Each round RE-LISTS rather than paginating: removed objects leave the candidate set, so a
 * cursor would skip every other batch (rule 9 is about rows that stay; these do not).
 */

export const STORY_SEGMENTS_BUCKET = 'story-segments';

/** storage-api's ceiling for one remove() call (docs: "1000 objects at a time"). */
export const REMOVE_BATCH = 1000;

/**
 * Rounds per invocation — 5 × 1000 objects. Sized to ANSWER inside the 30 s pg_net allows
 * `invoke_story_segment_reaper()` (a round is one RPC plus one Storage API delete of ≤ 1000
 * keys, realistically 1–5 s), not to drain any backlog in one go: a populated bucket on first
 * deploy drains ≤ 5000 a night and the response says `exhausted: false` until it is done.
 * Nothing is lost by waiting a night; a pg_net timeout on the reply would be.
 */
export const MAX_ROUNDS = 5;

export type RpcResult = { data: unknown; error: { message: string } | null };
export type RemoveResult = {
  data: { name: string }[] | null;
  error: { message: string } | null;
};

/** The two ports index.ts wires to the service-role client. */
export type ReaperPorts = {
  /** `db.rpc('story_segment_reap_candidates', { p_limit })` */
  listCandidates: (limit: number) => PromiseLike<RpcResult>;
  /** `db.storage.from(STORY_SEGMENTS_BUCKET).remove(paths)` */
  remove: (paths: string[]) => PromiseLike<RemoveResult>;
};

const candidateRows = z.array(z.object({ name: z.string().min(1) }));

export type ReapSummary = {
  /** objects the Storage API reports deleted */
  reaped: number;
  /**
   * listed and handed to remove(), but not in the API's answer — counted ONCE and never
   * retried in this run (a concurrent pass may have taken them, or the API left them); they
   * are re-listed tomorrow if still there
   */
  unremoved: number;
  /** list rounds performed */
  rounds: number;
  /** true when a round listed nothing new — the candidate set is drained */
  exhausted: boolean;
  error?: string;
};

export async function reapStorySegments(ports: ReaperPorts): Promise<Response> {
  const summary: ReapSummary = { reaped: 0, unremoved: 0, rounds: 0, exhausted: false };
  const attempted = new Set<string>();

  while (summary.rounds < MAX_ROUNDS) {
    summary.rounds++;

    const listed = await ports.listCandidates(REMOVE_BATCH);
    if (listed.error) return json({ ...summary, error: `list: ${listed.error.message}` }, 500);
    const parsed = candidateRows.safeParse(listed.data ?? []);
    if (!parsed.success) return json({ ...summary, error: 'list: malformed rows' }, 500);

    // Names already handed to remove() this run are not retried: the API answered without
    // them once, and the RPC lists oldest-first, so a leftover would head every later batch
    // and be counted again. Dedupe and clamp in the same pass — the RPC clamps p_limit too,
    // but the API ceiling is enforced here as well so nothing upstream can shape what
    // reaches remove().
    const paths: string[] = [];
    for (const { name } of parsed.data) {
      if (attempted.has(name)) continue;
      attempted.add(name);
      paths.push(name);
      if (paths.length === REMOVE_BATCH) break;
    }
    // Exhaustion is "the list had nothing new", never "the list was short": PostgREST's
    // max-rows setting can truncate an RPC result below REMOVE_BATCH on a healthy backlog.
    if (paths.length === 0) return json({ ...summary, exhausted: true });

    const removed = await ports.remove(paths);
    if (removed.error) return json({ ...summary, error: `remove: ${removed.error.message}` }, 500);

    // The API reports only what it deleted. Fewer than asked is not an error: a concurrent
    // run (the operator invoking by hand during the nightly pass) may have taken them first,
    // or the API left them — either way they are counted once here and re-listed tomorrow.
    const n = removed.data?.length ?? 0;
    summary.reaped += n;
    summary.unremoved += paths.length - n;
  }

  return json(summary);
}
