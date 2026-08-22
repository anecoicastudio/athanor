import { z } from 'zod';

/** Mirrors supabase/migrations post_media. Update both together. */
export const mediaKindSchema = z.enum(['image', 'video', 'audio']);

/**
 * Longest clip a post may carry, in seconds — the same 60 as `MEDIA_LIMITS.MAX_VIDEO_SECONDS`
 * in `@athanor/core` and the `post_media_duration_s_check` CHECK (#56). This package cannot
 * import core (core imports schemas, not the reverse), so the three copies are held together
 * by `post-media-duration.mirror.test.ts` rather than by a module boundary.
 *
 * Named here rather than spelled twice below because the insert schema RE-DECLARES the field
 * instead of picking it: two literals are two things to forget, and only one of them is the
 * one an upload actually goes through.
 *
 * It binds EVERY kind, audio included, because `duration_s` is one column and the CHECK has no
 * `kind` predicate — the same shape `moments` and `story_segments` carry. Nothing writes an
 * audio row today (`PickedMedia.kind` is `'image' | 'video'`, so no compose path produces one)
 * and the 1200 it replaces was never a considered bound for audio either. But a voice note is
 * the obvious thing to want past a minute, so whoever builds that surface decides then whether
 * audio gets its own bound — and does it as a product call with its own migration, not by
 * discovering a 23514 at runtime. Raising it here alone would only move the failure to the
 * database.
 */
export const POST_MEDIA_MAX_DURATION_SECONDS = 60;

export const postMediaSchema = z.object({
  id: z.string().uuid(),
  post_id: z.string().uuid(),
  kind: mediaKindSchema,
  storage_path: z.string().min(1),
  thumb_path: z.string().min(1).nullable(),
  duration_s: z.number().int().min(0).max(POST_MEDIA_MAX_DURATION_SECONDS).nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  position: z.number().int().min(0),
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

export type MediaKind = z.infer<typeof mediaKindSchema>;
export type PostMedia = z.infer<typeof postMediaSchema>;
export type PostMediaInsert = z.infer<typeof postMediaInsertSchema>;
