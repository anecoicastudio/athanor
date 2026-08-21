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
 * WHAT gets reaped is not decided here. `story_segment_reap_candidates` (security definer,
 * service_role-only, pgTAP 0126) lists objects in the bucket with no descriptor row that was
 * live or pinned within the last hour — the SELECT policy's inverse with a grace margin, so a
 * `pinned` step is never a candidate, an in-flight upload (object older than the row, or a
 * row whose upload is still running) is never a candidate, and the hourly staging refresh that
 * revives seeded rows in place always wins against a nightly pass. This file is only the loop.
 *
 * Each round RE-LISTS rather than paginating: removed objects leave the candidate set, so a
 * cursor would skip every other batch (rule 9 is about rows that stay; these do not).
 */

export const STORY_SEGMENTS_BUCKET = 'story-segments';

/** storage-api's ceiling for one remove() call (docs: "1000 objects at a time"). */
export const REMOVE_BATCH = 1000;

/**
 * Rounds per invocation. 20 × 1000 objects is far beyond a day's worth of expiring segments;
 * the bound exists so a pathological backlog is drained across nights instead of holding one
 * isolate past its wall-clock limit. The response says `exhausted: false` when it trips.
 */
export const MAX_ROUNDS = 20;

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
  /** listed-but-not-deleted in this run (the API answered without them); re-listed next night */
  unremoved: number;
  rounds: number;
  /** true when a round listed fewer than REMOVE_BATCH — the candidate set is drained */
  exhausted: boolean;
  /** a round removed nothing at all: stop rather than spin on an API that is not deleting */
  stalled?: true;
  error?: string;
};

export async function reapStorySegments(ports: ReaperPorts): Promise<Response> {
  const summary: ReapSummary = { reaped: 0, unremoved: 0, rounds: 0, exhausted: false };

  while (summary.rounds < MAX_ROUNDS) {
    summary.rounds++;

    const listed = await ports.listCandidates(REMOVE_BATCH);
    if (listed.error) return json({ ...summary, error: `list: ${listed.error.message}` }, 500);
    const parsed = candidateRows.safeParse(listed.data ?? []);
    if (!parsed.success) return json({ ...summary, error: 'list: malformed rows' }, 500);

    // Dedupe and clamp: the RPC clamps p_limit too, but the API ceiling is enforced here as
    // well so a widened RPC can never produce an oversized remove().
    const paths = [...new Set(parsed.data.map((r) => r.name))].slice(0, REMOVE_BATCH);
    if (paths.length === 0) return json({ ...summary, exhausted: true });

    const removed = await ports.remove(paths);
    if (removed.error) return json({ ...summary, error: `remove: ${removed.error.message}` }, 500);

    const n = removed.data?.length ?? 0;
    summary.reaped += n;
    summary.unremoved += paths.length - n;
    if (n === 0) return json({ ...summary, stalled: true }, 500);
    if (paths.length < REMOVE_BATCH) return json({ ...summary, exhausted: true });
  }

  return json(summary);
}
