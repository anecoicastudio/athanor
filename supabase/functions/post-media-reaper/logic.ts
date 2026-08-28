/**
 * post-media-reaper (#589) — frees the bytes `publish_post` deliberately leaves behind.
 *
 * `20260828083140_publish_post_atomic.sql` writes a post and its media set in one transaction
 * and sweeps every `post_media` row the new set does not fill, so the ROWS have been exactly
 * right since #588. Its header names what it does not do: "The BYTES are not swept." Two
 * sources — superseded (a previous set's tail positions, and the old key at a position whose
 * kind changed, poster included) and abandoned (bytes uploaded before a publish the member
 * then walks away from, since `post-compose.tsx` uploads before it writes). Neither is a
 * compliance gap — `gdpr_storage_footprint` sweeps the bucket by `{uid}/` prefix — so this is
 * storage cost, and a nightly pass is the right cadence for it.
 *
 * The loop lives in `_shared/reap.ts`, shared with `story-segment-reaper`; the candidate
 * predicate lives in SQL (`post_media_reap_candidates`, pgTAP 0139) next to the table it
 * diffs. What is here is the bucket and the wiring.
 */
export { MAX_ROUNDS, REMOVE_BATCH } from '../_shared/reap.ts';
export type { ReaperPorts, ReapSummary, RemoveResult, RpcResult } from '../_shared/reap.ts';
export { reapBucket as reapPostMedia } from '../_shared/reap.ts';

export const POST_MEDIA_BUCKET = 'post-media';
