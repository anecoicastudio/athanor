import { z } from 'zod';
import { nonBlankString, trimmedNonBlank } from './primitives';

/** Mirrors supabase/migrations community_post_comments. A reply on a post. */
export const postCommentSchema = z.object({
  id: z.string().uuid(),
  post_id: z.string().uuid(),
  author_id: z.string().uuid(),
  parent_id: z.string().uuid().nullable(),
  body: nonBlankString(2000, 'comment body must not be blank'),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});

/** Shared write-path rule for a comment body: trim, then 1–2000 chars. */
const commentBodySchema = trimmedNonBlank(2000, 'comment body must not be blank');

/** Adding a reply — post_id + author_id + body; parent_id optional (null = top-level). */
export const postCommentInsertSchema = postCommentSchema
  .pick({ post_id: true, author_id: true })
  .extend({
    body: commentBodySchema,
    parent_id: z.string().uuid().nullable().default(null),
  });

export type PostComment = z.infer<typeof postCommentSchema>;
export type PostCommentInsert = z.infer<typeof postCommentInsertSchema>;
