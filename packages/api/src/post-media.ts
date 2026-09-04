import { type PostMedia, postMediaSchema } from '@athanor/schemas';
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

/*
  Writing a media set lives in `publishPost` (`posts.ts`), not here, and that is #588's whole
  point rather than a filing decision. `replacePostMedia` wrote the set in a SECOND request,
  after the post row had already been committed by `createPost`, so a failure between them left
  a post whose `type` claimed media with nothing behind it — the silently text-only card. The
  two writes are one `publish_post` transaction now, and the set-replacing rationale that used
  to live here — upsert on `(post_id, position)` and not the PK, sweep every position the new
  set does not fill, an empty set being the case the sweep exists for (#586) — moved with it,
  into that docblock and into the migration.
*/
