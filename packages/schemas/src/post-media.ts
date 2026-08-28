import { z } from 'zod';

/** Mirrors supabase/migrations post_media. Update both together. */
export const mediaKindSchema = z.enum(['image', 'video', 'audio']);

/**
 * Longest clip a post may carry, in seconds — the same 60 as `MEDIA_LIMITS.MAX_CLIP_SECONDS`
 * in `@athanor/core` and the `post_media_duration_s_check` CHECK (#56). This package cannot
 * import core (core imports schemas, not the reverse), so the copies are held together by
 * `post-media-duration.mirror.test.ts` rather than by a module boundary — which since #154
 * also pins the three catalog sentences that spell the number in prose to a member
 * (`media.tooLong`, `media.sheet.video`, `media.sheet.audio`), in both catalogs.
 *
 * Named here rather than spelled twice below because the insert schema RE-DECLARES the field
 * instead of picking it: two literals are two things to forget, and only one of them is the
 * one an upload actually goes through.
 *
 * It binds EVERY kind, audio included, because `duration_s` is one column and the CHECK has no
 * `kind` predicate — the same shape `moments` and `story_segments` carry.
 *
 * **That was inherited rather than chosen until #154, which chose it.** Until the in-app voice
 * recorder landed, nothing could write an audio row at all — `expo-image-picker` has no audio
 * media type — so the bound applied to a kind no surface produced, and the 1200 it replaces
 * was never a considered bound for audio either. Building the recorder forced the question,
 * and the answer is one bound for both kinds: the cap is a property of a POST, not of a codec.
 * A post may carry both kinds at once while `derivePostType` collapses it to a single type, so
 * a voice note running five times longer than the video beside it would make one number mean
 * two things in one card — and `MEDIA_LIMITS.MAX_POST_MEDIA` is 10, so 60s already buys ten
 * minutes per post. `supabase/tests/0012_post_media_rls.test.sql` now asserts the boundary for
 * an audio row as well as a video one, so the shared bound is a tested property rather than an
 * accident of the CHECK's shape.
 *
 * Should audio ever want its own bound, it takes a kind-conditional CHECK in a new migration —
 * and `declaredBound()` in the mirror test parses only the flat form, so that migration must
 * teach it the new shape or the mirror silently falls back to the previous bound. Raising the
 * number here alone would only move the failure to the database.
 */
export const POST_MEDIA_MAX_DURATION_SECONDS = 60;

/**
 * How many media rows one post may carry — the same 10 as `MEDIA_LIMITS.MAX_POST_MEDIA` in
 * `@athanor/core` (#591), held to it by `post-media-count.mirror.test.ts` for the same reason
 * as the duration above: this package cannot import core.
 *
 * It is a COUNT, and what the row schema below can express is a bound on `position`, so it is
 * spelled `.max(POST_MEDIA_MAX_COUNT - 1)` there. That is not a convenience: it is exactly how
 * the database states it. `post_media_position_check` confines `position` to `[0, 10)` and
 * `post_media_post_position` is UNIQUE on (post_id, position), so ten admissible slots holding
 * one row each is the cap — no row ever counts its siblings, and no writer can race it.
 * Anything that changes the number changes a migration too.
 */
export const POST_MEDIA_MAX_COUNT = 10;

export const postMediaSchema = z.object({
  id: z.string().uuid(),
  post_id: z.string().uuid(),
  kind: mediaKindSchema,
  storage_path: z.string().min(1),
  thumb_path: z.string().min(1).nullable(),
  duration_s: z.number().int().min(0).max(POST_MEDIA_MAX_DURATION_SECONDS).nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  position: z
    .number()
    .int()
    .min(0)
    .max(POST_MEDIA_MAX_COUNT - 1),
  created_at: z.string(),
  updated_at: z.string(),
});

/** Authoring a media row — post_id + kind + path + position; dims/duration/thumb optional. */
export const postMediaInsertSchema = postMediaSchema
  .pick({ post_id: true, kind: true, storage_path: true, position: true })
  .extend({
    thumb_path: z.string().min(1).nullable().default(null),
    duration_s: z
      .number()
      .int()
      .min(0)
      .max(POST_MEDIA_MAX_DURATION_SECONDS)
      .nullable()
      .default(null),
    width: z.number().int().positive().nullable().default(null),
    height: z.number().int().positive().nullable().default(null),
  });

/**
 * One row of the set the composer hands to `publish_post` (#588) — the insert shape minus
 * `post_id`.
 *
 * The RPC assigns the parent from the post it is publishing in the same statement, so a row
 * aimed at somebody else's post is not refused, it is unrepresentable. That retires
 * `replacePostMedia`'s foreign-row guard rather than moving it: a check that can only ever pass
 * is a check nobody maintains.
 */
export const postMediaPublishSchema = postMediaInsertSchema.omit({ post_id: true });

export type MediaKind = z.infer<typeof mediaKindSchema>;
export type PostMedia = z.infer<typeof postMediaSchema>;
export type PostMediaInsert = z.infer<typeof postMediaInsertSchema>;
export type PostMediaPublish = z.infer<typeof postMediaPublishSchema>;
