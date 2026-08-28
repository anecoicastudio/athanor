import { z } from 'zod';
import { json } from './respond.ts';

/**
 * The storage-reaper loop, shared by every bucket that has one.
 *
 * Extracted from `story-segment-reaper/logic.ts` when `post-media-reaper` (#589) needed the
 * identical loop over a different bucket. Nothing about the loop was bucket-specific: what
 * differs per reaper is WHICH objects (a SQL predicate, living next to the table it inverts or
 * diffs) and the bucket name the Storage API is asked to delete from. Both arrive here as
 * ports, so a second copy of the batching, dedupe and exhaustion rules cannot drift from the
 * first. `story-segment-reaper/logic.test.ts` is this loop's regression suite and is unchanged
 * by the extraction — that is what makes the move provably behaviour-preserving.
 *
 * Deletion goes through the Storage API in every case. Deleting `storage.objects` rows in SQL
 * leaves the physical file behind ("inaccessible, but you'll still be billed for it" —
 * supabase.com/docs/guides/storage/schema/design), which is the same reason erasure-job
 * removes candidacy videos through `storage.from().remove()`.
 *
 * Each round RE-LISTS rather than paginating: removed objects leave the candidate set, so a
 * cursor would skip every other batch (rule 9 is about rows that stay; these do not).
 */

/** storage-api's ceiling for one remove() call (docs: "1000 objects at a time"). */
export const REMOVE_BATCH = 1000;

/**
 * Rounds per invocation — 5 × 1000 objects. Sized to ANSWER inside the 30 s the pg_net callers
 * allow (a round is one RPC plus one Storage API delete of ≤ 1000 keys, realistically 1–5 s),
 * not to drain any backlog in one go: a populated bucket on first deploy drains ≤ 5000 a night
 * and the response says `exhausted: false` until it is done. Nothing is lost by waiting a
 * night; a pg_net timeout on the reply would be.
 */
export const MAX_ROUNDS = 5;

export type RpcResult = { data: unknown; error: { message: string } | null };
export type RemoveResult = {
  data: { name: string }[] | null;
  error: { message: string } | null;
};

/** The two ports each reaper's index.ts wires to its service-role client. */
export type ReaperPorts = {
  /** `db.rpc('<bucket>_reap_candidates', { p_limit })` */
  listCandidates: (limit: number) => PromiseLike<RpcResult>;
  /** `db.storage.from(<bucket>).remove(paths)` */
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

export async function reapBucket(ports: ReaperPorts): Promise<Response> {
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
