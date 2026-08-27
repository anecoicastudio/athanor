import { type FeedFrontier, mergeBoostedFeed } from '@athanor/core';
import {
  type Post,
  type PostCategory,
  type PostInsert,
  postInsertSchema,
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
 * Create a post (text this slice; type defaults to 'text'). RLS enforces
 * author = (select auth.uid()). Creating a post is the +6 domain event the M6
 * engine reads — this writes only `posts`, never Aura (rule #1).
 * TODO(M6): the score-engine (backend `07`) consumes this insert for the +6 award.
 *
 * Idempotent on an `id` the caller mints (#579). `upsert`, not `insert`, and the difference
 * only shows on a retry: the composer sends its own uuid as the PK, so a re-tap after a
 * response was lost converges the row that already exists on what the member has on screen.
 * A plain insert answers that with a 23505, and a caller that swallows one to avoid minting a
 * duplicate post silently discards whatever they edited between the two taps.
 *
 * It cannot overwrite a post that is not the caller's: `posts_update_own` carries
 * `(select auth.uid()) = author_id` in USING as well as WITH CHECK, so a colliding id
 * belonging to someone else is refused rather than merged, and nothing of theirs is returned
 * either way. #106's restrictive `active_write_update` sits on the same path, so a suspended
 * author's converge is gated exactly like any other update.
 *
 * Note what that costs even when no `id` is sent: supabase-js always sends
 * `Prefer: resolution=merge-duplicates`, so every call goes out as
 * `INSERT … ON CONFLICT (id) DO UPDATE` and traverses the UPDATE grant and policies as well
 * as the INSERT ones. With no `id` there is nothing that can conflict, so the OUTCOME is the
 * insert every caller had before #579 — but it is not the statement that used to be sent, and
 * a future policy change on the update side would be felt here.
 *
 * `subscribeNewPosts` filters `event: 'INSERT'`, so a converge emits UPDATE and does not
 * re-fire the "Nuovi passi ›" banner for a post the feed already showed.
 */
export async function createPost(client: AthanorClient, insert: PostInsert): Promise<Post> {
  const payload = postInsertSchema.parse(insert);
  const { data, error } = await client.from('posts').upsert(payload).select('*').single();
  if (error) throw error;
  return postSchema.parse(data);
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
