import { postReactionInsertSchema } from '@athanor/schemas';
import type { AthanorClient } from './client';

/**
 * The viewer's own ✦ state for a post (drives lit/unlit). Own-row RLS means this
 * returns at most the caller's single reaction row — never a public count.
 */
export async function getViewerReaction(client: AthanorClient, postId: string): Promise<boolean> {
  const { data, error } = await client
    .from('post_reactions')
    .select('id')
    .eq('post_id', postId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/**
 * Toggle the ✦ (light/unlit). One per (post, person); insert/delete own row.
 * `personId` is the caller's auth uid — RLS WITH CHECK re-verifies it, and the
 * insert policy blocks ✦ on your own post. Inserting a ✦ is the M6 domain event
 * the score-engine reads — this writes only `post_reactions`, never aura (rule #1).
 * Returns the new lit state. TODO(M6): the engine awards the reaction points.
 */
export async function togglePostReaction(
  client: AthanorClient,
  postId: string,
  personId: string,
): Promise<boolean> {
  const reacted = await getViewerReaction(client, postId);
  if (reacted) {
    const { error } = await client
      .from('post_reactions')
      .delete()
      .eq('post_id', postId)
      .eq('person_id', personId);
    if (error) throw error;
    return false;
  }
  const payload = postReactionInsertSchema.parse({ post_id: postId, person_id: personId });
  const { error } = await client.from('post_reactions').insert(payload);
  if (error) throw error;
  return true;
}

/**
 * The author-only ✦ count for a post (anti-vanity, CLAUDE.md #3). Returns the true
 * total to the post author and 0 to everyone else (the RPC is SECURITY DEFINER +
 * author-gated). NEVER call this to render a public number — only in the author path.
 */
export async function getAuthorReactionCount(
  client: AthanorClient,
  postId: string,
): Promise<number> {
  const { data, error } = await client.rpc('post_reaction_count', { p_post_id: postId });
  if (error) throw error;
  return data ?? 0;
}
