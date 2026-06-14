/**
 * Local UI shape for a personal Momento — M1 **frame-only**.
 *
 * The live `moments` table + `moments` Storage bucket are DEFERRED TO M3
 * (backend `10` §4.1 stages the bucket at M3; no `moments` table DDL exists in
 * the backend PRD suite, and the Foundation `sheet-media` picker is unbuilt).
 * See docs/MILESTONES.md → M1 `own-momenti-gallery` decision (frame-only).
 *
 * M3 replaces this module with `@athanor/schemas` `Moment` +
 * `useQuery(momentKeys.list(uid))` (cursor-paginated, never offset —
 * `.claude/rules/api.md`) and a Storage-backed create. Until then a real new
 * user has zero momenti — the gallery/grid render their empty states.
 */
export type MomentMediaType = 'photo' | 'video';

export interface Moment {
  id: string;
  type: MomentMediaType;
  /** Storage URL — null in M1 (no `moments` bucket yet); M3 fills it. */
  mediaUrl: string | null;
  thumbUrl: string | null;
  caption: string | null;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
}

/** M1: a real new user has no momenti. M3 swaps this for a live query. */
export const MY_MOMENTS: Moment[] = [];
