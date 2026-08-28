import { type FeedFrontier, mergeBoostedFeed } from '@athanor/core';
import {
  type Post,
  type PostCategory,
  type PostMediaPublish,
  postMediaPublishSchema,
  type PostPublish,
  type PostPublishResult,
  postPublishResultSchema,
  postPublishSchema,
  postSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';
import { getConnectionPeerIds } from './connections';
import { keysetFilter } from './pagination';
import { channelTopic } from './realtime';

export const postKeys = {
  all: ['posts'] as const,
  feed: (category: PostCategory | 'all') => ['posts', 'feed', category] as const,
  detail: (id: string) => ['posts', 'detail', id] as const,
  comments: (id: string) => ['posts', 'comments', id] as const,
  reactions: (id: string) => ['posts', 'reactions', id] as const, // author-only count
};

/** The last (created_at, id) a single stream has consumed. Never an offset. */
export type FeedKeysetPoint = { created_at: string; id: string };

/**
 * Opaque feed cursor (#152): one raw keyset point per stream (chronological /
 * connection-authored), the merge frontier, and the first page's peer snapshot —
 * carried through the whole scroll so every page ranks against the same set.
 */
export type FeedCursor = {
  chrono: FeedKeysetPoint | null;
  conn: FeedKeysetPoint | null;
  frontier: FeedFrontier | null;
  peerIds: string[];
};
export type FeedPage = { posts: Post[]; nextCursor: FeedCursor | null };

const FEED_PAGE_SIZE = 20;

/**
 * One page of the Community feed: chronological backbone with the light
 * first-degree connection boost (#152, PRD §4.5). Two keyset streams — the plain
 * chronological page and the connection-authored page — each on its own raw
 * `(created_at, id)` cursor (rule #9: never offset), merged by
 * `mergeBoostedFeed` in `@athanor/core`. Blocked authors never appear because the
 * posts SELECT policy (`athanor.not_blocked`) filters both streams server-side.
 * `category: 'all'` spans every category. `cursor` is the last page's
 * `nextCursor`; pass null/undefined for the first page.
 */
export async function getFeedPage(
  client: AthanorClient,
  opts: { category: PostCategory | 'all'; cursor?: FeedCursor | null; limit?: number } = {
    category: 'all',
  },
): Promise<FeedPage> {
  const limit = opts.limit ?? FEED_PAGE_SIZE;
  const cursor = opts.cursor ?? null;
  const peerIds = cursor ? cursor.peerIds : await getConnectionPeerIds(client);

  const fetchStream = async (
    point: FeedKeysetPoint | null,
    authors?: readonly string[],
  ): Promise<Post[]> => {
    let query = client
      .from('posts')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);

    if (opts.category !== 'all') query = query.eq('category', opts.category);
    if (authors) query = query.in('author_id', [...authors]);

    // keyset: (created_at, id) < (point.created_at, point.id), expressed for PostgREST
    if (point) {
      query = query.or(keysetFilter('created_at', 'id', point.created_at, point.id, 'lt'));
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => postSchema.parse(row));
  };

  // Thenables resolve in array order, so the FIFO-scripted test fake stays deterministic.
  const [chrono, boosted] = await Promise.all([
    fetchStream(cursor?.chrono ?? null),
    peerIds.length > 0 ? fetchStream(cursor?.conn ?? null, peerIds) : Promise.resolve([]),
  ]);

  const merged = mergeBoostedFeed({
    chrono,
    boosted,
    peerIds: new Set(peerIds),
    limit,
    // A full page means more rows may exist beyond that stream's horizon.
    chronoMayHaveMore: chrono.length === limit,
    boostedMayHaveMore: boosted.length === limit,
    frontier: cursor?.frontier ?? null,
  });

  const nextCursor: FeedCursor | null = merged.done
    ? null
    : {
        chrono: merged.lastChrono
          ? { created_at: merged.lastChrono.created_at, id: merged.lastChrono.id }
          : (cursor?.chrono ?? null),
        conn: merged.lastBoosted
          ? { created_at: merged.lastBoosted.created_at, id: merged.lastBoosted.id }
          : (cursor?.conn ?? null),
        frontier: merged.frontier,
        peerIds,
      };
  return { posts: merged.posts, nextCursor };
}

/** A single post (modal detail). Null when missing or soft-deleted. */
export async function getPostById(client: AthanorClient, id: string): Promise<Post | null> {
  const { data, error } = await client
    .from('posts')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return postSchema.parse(data);
}

/**
 * Publish a post and its media set as ONE transaction — the `publish_post` RPC (#588).
 *
 * This used to be two calls: `createPost` upserted the row, then `replacePostMedia` wrote the
 * set. Both converged under a retry, but the post was COMMITTED between them, so a media write
 * that failed for any reason left a row whose `type` claimed media with nothing behind it — and
 * `PostMedia` returns null on zero rows, so the post published as a silently text-only card.
 * PostgREST has no client-side transaction, so no ordering of two requests could close that;
 * the statements had to move behind one function. Both are gone rather than kept beside this,
 * because a second, non-atomic way to write the same two tables is how the defect returns.
 *
 * Idempotent on an `id` the caller mints (#579): the composer sends its own uuid as the PK, so
 * a re-tap after a lost response converges the row that already exists on what the member has
 * on screen — where a plain insert answers with a 23505 and a caller that swallows one to avoid
 * minting a duplicate silently discards whatever they edited in between. The media set
 * converges the same way, on `(post_id, position)`, and the RPC then deletes every position the
 * new set does not fill — including all of them, when the member removed every attachment
 * (#586). That sweep is why the set is passed WHOLE and never conditionally: an empty array is
 * not "nothing to do", it is the case the sweep exists for.
 *
 * It cannot touch a post that is not the caller's, and not because this function checks. The
 * RPC is SECURITY INVOKER, so `posts_update_own` (ownership in USING as well as WITH CHECK),
 * the three `post_media_*_post_author` policies and #106's restrictive `active_write_*` net all
 * still run as the caller. `author_id` and each row's `post_id` are not on the wire at all —
 * the RPC derives one from `auth.uid()` and assigns the other — so a row aimed at someone
 * else's post is unrepresentable rather than merely refused.
 *
 * Writing a post is the +6 domain event the M6 engine reads; this writes no Aura (rule #1).
 * TODO(M6): the score-engine (backend `07`) consumes the insert for the +6 award.
 *
 * The converge is an UPDATE, never a delete-and-reinsert: `subscribeNewPosts` filters
 * `event: 'INSERT'`, so a retry does not re-fire the "Nuovi passi ›" banner for a post the feed
 * already showed.
 *
 * The BYTES are not swept. Objects a previous set uploaded and this one does not reference stay
 * in the `post-media` bucket — the same trade the composer already makes for an abandoned
 * draft, and a storage cost rather than a visible defect. Erasure still reaches them, because
 * `gdpr_storage_footprint` sweeps the bucket by `{uid}/` prefix.
 *
 * Rethrows, deliberately. The publish is idempotent by construction, so a false failure costs
 * one more tap; swallowing one would toast success over a post that does not exist.
 */
export async function publishPost(
  client: AthanorClient,
  post: PostPublish,
  media: PostMediaPublish[] = [],
): Promise<PostPublishResult> {
  const parsed = postPublishSchema.parse(post);
  const rows = media.map((row) => postMediaPublishSchema.parse(row));
  const { data, error } = await client.rpc('publish_post', {
    p_category: parsed.category,
    p_body: parsed.body,
    p_type: parsed.type,
    p_is_step: parsed.is_step,
    p_tags: parsed.tags,
    p_media: rows,
    ...(parsed.id === undefined ? {} : { p_id: parsed.id }),
  });
  if (error) throw error;
  return postPublishResultSchema.parse(data);
}

/** Soft-delete an own post (owner UPDATE policy; no hard delete). Idempotent. */
export async function softDeletePost(client: AthanorClient, id: string): Promise<void> {
  const { error } = await client
    .from('posts')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null);
  if (error) throw error;
}

/**
 * Subscribe to new posts (realtime INSERT) for the "Nuovi passi ›" banner.
 * Fires `onInsert` with each new row; the caller filters by category client-side.
 * Returns a cleanup fn — callers MUST call it on unmount (rule `api.md`).
 */
export function subscribeNewPosts(
  client: AthanorClient,
  onInsert: (post: Post) => void,
): () => void {
  const channel = client
    .channel(channelTopic('public:posts:insert'))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, (payload) => {
      const parsed = postSchema.safeParse(payload.new);
      if (parsed.success) onInsert(parsed.data);
    })
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
