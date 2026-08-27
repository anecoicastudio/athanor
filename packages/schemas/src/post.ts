import { z } from 'zod';
import { nonBlankString, trimmedNonBlank } from './primitives.ts';

/** Mirrors supabase/migrations feed_posts. Update both together. */
export const postCategorySchema = z.enum(['business', 'human', 'creative', 'evolution']);
export const postTypeSchema = z.enum(['text', 'image', 'video', 'audio']);

export const postSchema = z.object({
  id: z.string().uuid(),
  author_id: z.string().uuid(),
  category: postCategorySchema,
  type: postTypeSchema,
  body: nonBlankString(5000, 'post body must not be blank'),
  is_step: z.boolean(),
  tags: z.array(z.string()).max(8),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});

/** Shared write-path rule for post body: trim, then 1–5000 chars. */
const postBodySchema = trimmedNonBlank(5000, 'post body must not be blank');

/**
 * Authoring a post — type defaults to 'text', tags optional.
 *
 * `id` optional (#579), the same SHAPE `postCommentInsertSchema` has carried since #101 — but
 * not the same resolution, and the difference is worth spelling out because the two sit one
 * table apart. The composer mints the uuid before it writes anything and sends it as the PK,
 * so a second tap after a lost response lands on the row the first one wrote. A comment then
 * conflicts, because `addComment` inserts; a post CONVERGES, because `createPost` upserts and
 * a member who edited their draft after the failure must get what is on their screen.
 *
 * It must be a FIELD rather than a value the caller passes anyway — a zod object strips what
 * it does not declare, so an undeclared `id` would be dropped here in silence and the row
 * would take its `gen_random_uuid()` default, which is exactly the duplicate this closes.
 */
export const postInsertSchema = postSchema
  .pick({ id: true, author_id: true, category: true })
  .partial({ id: true })
  .extend({
    type: postTypeSchema.default('text'),
    body: postBodySchema,
    is_step: z.boolean().default(false),
    tags: z.array(z.string()).max(8).default([]),
  });

export type Post = z.infer<typeof postSchema>;
export type PostCategory = z.infer<typeof postCategorySchema>;
export type PostType = z.infer<typeof postTypeSchema>;
export type PostInsert = z.infer<typeof postInsertSchema>;
