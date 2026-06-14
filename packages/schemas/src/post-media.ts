import { z } from 'zod';

/** Mirrors supabase/migrations post_media. Update both together. */
export const mediaKindSchema = z.enum(['image', 'video', 'audio']);

export const postMediaSchema = z.object({
  id: z.string().uuid(),
  post_id: z.string().uuid(),
  kind: mediaKindSchema,
  storage_path: z.string().min(1),
  duration_s: z.number().int().min(0).max(1200).nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  position: z.number().int().min(0),
  created_at: z.string(),
  updated_at: z.string(),
});

/** Authoring a media row — post_id + kind + path + position; dims/duration optional. */
export const postMediaInsertSchema = postMediaSchema
  .pick({ post_id: true, kind: true, storage_path: true, position: true })
  .extend({
    duration_s: z.number().int().min(0).max(1200).nullable().default(null),
    width: z.number().int().positive().nullable().default(null),
    height: z.number().int().positive().nullable().default(null),
  });

export type MediaKind = z.infer<typeof mediaKindSchema>;
export type PostMedia = z.infer<typeof postMediaSchema>;
export type PostMediaInsert = z.infer<typeof postMediaInsertSchema>;
