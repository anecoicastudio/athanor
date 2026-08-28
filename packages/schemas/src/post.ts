import { z } from 'zod';
import { postMediaSchema } from './post-media.ts';
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
 * conflicts, because `addComment` inserts; a post CONVERGES, because `publish_post` upserts on
 * the PK and a member who edited their draft after the failure must get what is on their
 * screen.
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

/**
 * What the composer sends to `publish_post` (#588) — the insert shape minus `author_id`.
 *
 * Derived, never re-declared: the body rule, the optional client-minted `id` and the three
 * defaults are `postInsertSchema`'s, and stay its. What this subtracts is the one field the
 * caller does not own. The RPC reads `auth.uid()`, the way an edge function derives
 * `profile_id` from `getUser()` rather than from the request body — `posts_insert_own` would
 * refuse a lie anyway, so a field nobody may set is a field that should not be on the wire.
 */
export const postPublishSchema = postInsertSchema.omit({ author_id: true });

/**
 * What `publish_post` answers with: the post as it now stands and its media set entire, in
 * position order. The media half is read back from the table rather than from the upsert, so
 * it reflects the sweep as well as the write — an empty array is a post that no longer carries
 * media, not a post whose media went unreported.
 */
export const postPublishResultSchema = z.object({
  post: postSchema,
  media: z.array(postMediaSchema),
});

export type Post = z.infer<typeof postSchema>;
export type PostCategory = z.infer<typeof postCategorySchema>;
export type PostType = z.infer<typeof postTypeSchema>;
export type PostInsert = z.infer<typeof postInsertSchema>;
export type PostPublish = z.infer<typeof postPublishSchema>;
export type PostPublishResult = z.infer<typeof postPublishResultSchema>;
