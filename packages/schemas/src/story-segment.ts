import { z } from 'zod';

/** Mirrors supabase/migrations story_segments. Update both together. */
export const storyKindSchema = z.enum(['photo', 'video']);
const captionSchema = z.string().trim().max(280).nullable();

export const storySegmentSchema = z.object({
  id: z.string().uuid(),
  author_id: z.string().uuid(),
  kind: storyKindSchema,
  storage_path: z.string().min(1),
  duration_s: z.number().int().min(0).max(60).nullable(),
  caption: captionSchema,
  is_step: z.boolean(),
  pinned: z.boolean(),
  expires_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});

export const storySegmentInsertSchema = storySegmentSchema
  .pick({ author_id: true, kind: true, storage_path: true })
  .extend({
    duration_s: z.number().int().min(0).max(60).nullable().default(null),
    caption: captionSchema.default(null),
    is_step: z.boolean().default(false),
  });

export type StoryKind = z.infer<typeof storyKindSchema>;
export type StorySegment = z.infer<typeof storySegmentSchema>;
export type StorySegmentInsert = z.infer<typeof storySegmentInsertSchema>;
