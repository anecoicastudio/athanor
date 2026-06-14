import {
  type PostMedia,
  type PostMediaInsert,
  postMediaInsertSchema,
  postMediaSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

export const postMediaKeys = {
  all: ['post-media'] as const,
  forPost: (postId: string) => ['post-media', postId] as const,
};

/** Ordered media descriptors for a post (position asc). Empty for a text post. */
export async function getPostMedia(client: AthanorClient, postId: string): Promise<PostMedia[]> {
  const { data, error } = await client
    .from('post_media')
    .select('*')
    .eq('post_id', postId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => postMediaSchema.parse(row));
}

/**
 * Insert media rows for an already-created post (author-only via RLS). Bytes must be
 * uploaded to the post-media bucket first. Adding media does not write Aura (rule #1);
 * the +6 post event is emitted at post creation (TODO(M6)).
 */
export async function addPostMedia(
  client: AthanorClient,
  rows: PostMediaInsert[],
): Promise<PostMedia[]> {
  const payload = rows.map((r) => postMediaInsertSchema.parse(r));
  const { data, error } = await client.from('post_media').insert(payload).select('*');
  if (error) throw error;
  return (data ?? []).map((row) => postMediaSchema.parse(row));
}
