/**
 * story-segment-reaper (#31) — the byte-side half of the nightly story prune.
 *
 * `20260809151111_story_segment_storage_expiry.sql` hides an expired or soft-deleted segment's
 * object behind the storage SELECT policy; `prune_expired_story_segments()` soft-deletes the
 * rows. Neither frees the bytes. The loop that does now lives in `_shared/reap.ts`, shared
 * with `post-media-reaper` (#589) — nothing in it was ever story-specific. What stays here is
 * the bucket this reaper is FOR; `logic.test.ts` is the loop's regression suite and imports it
 * through this module, so it is unchanged by the extraction.
 *
 * WHAT gets reaped is not decided here either. `story_segment_reap_candidates`
 * (service_role-only, pgTAP 0126) lists objects in the bucket with no descriptor row that was
 * live or pinned within the last hour — the SELECT policy's descriptor predicate inverted,
 * with a grace margin (its viewer-side arms — owner folder, blocks, bans — are about who may
 * read, not whether the segment is alive, and are deliberately not mirrored). So a pinned,
 * undeleted step is never a candidate, an in-flight upload (a row whose upload is still
 * running, or an object younger than the grace) is never a candidate, and the hourly staging
 * refresh that revives seeded rows in place always wins against a nightly pass.
 */
export { MAX_ROUNDS, REMOVE_BATCH } from '../_shared/reap.ts';
export type { ReaperPorts, ReapSummary, RemoveResult, RpcResult } from '../_shared/reap.ts';
export { reapBucket as reapStorySegments } from '../_shared/reap.ts';

export const STORY_SEGMENTS_BUCKET = 'story-segments';
