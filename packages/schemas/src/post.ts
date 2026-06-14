import { z } from 'zod';

/** Mirrors supabase/migrations feed_posts. Update both together. */
export const postCategorySchema = z.enum(['business', 'human', 'creative', 'evolution']);
export const postTypeSchema = z.enum(['text', 'image', 'video', 'audio']);

export const postSchema = z.object({
  id: z.string().uuid(),
  author_id: z.string().uuid(),
  category: postCategorySchema,
  type: postTypeSchema,
  body: z
    .string()
    .max(5000)
    .refine((v) => v.trim().length > 0, 'post body must not be blank'),
  is_step: z.boolean(),
  tags: z.array(z.string()).max(8),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});

/** Shared write-path rule for post body: trim, then 1–5000 chars. */
const postBodySchema = z.string().trim().min(1, 'post body must not be blank').max(5000);

/** Authoring a post — text-only this slice; type defaults to 'text', tags optional. */
export const postInsertSchema = postSchema.pick({ author_id: true, category: true }).extend({
  body: postBodySchema,
  is_step: z.boolean().default(false),
  tags: z.array(z.string()).max(8).default([]),
});

/** Editing an own post — body only (trim, 1–5000). */
export const postUpdateSchema = z.object({ body: postBodySchema });

export type Post = z.infer<typeof postSchema>;
export type PostCategory = z.infer<typeof postCategorySchema>;
export type PostType = z.infer<typeof postTypeSchema>;
export type PostInsert = z.infer<typeof postInsertSchema>;
export type PostUpdate = z.infer<typeof postUpdateSchema>;
