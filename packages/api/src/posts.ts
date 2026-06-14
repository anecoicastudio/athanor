import {
  type Post,
  type PostCategory,
  type PostInsert,
  postInsertSchema,
  postSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

export const postKeys = {
  all: ['posts'] as const,
  feed: (category: PostCategory | 'all') => ['posts', 'feed', category] as const,
  detail: (id: string) => ['posts', 'detail', id] as const,
  comments: (id: string) => ['posts', 'comments', id] as const,
  reactions: (id: string) => ['posts', 'reactions', id] as const, // author-only count
};

/** Opaque keyset cursor — the last (created_at, id) the caller has seen. Never an offset. */
export type FeedCursor = { created_at: string; id: string };
export type FeedPage = { posts: Post[]; nextCursor: FeedCursor | null };

const FEED_PAGE_SIZE = 20;

/**
 * One page of the Community feed, newest-first by the (created_at, id) keyset
 * (rule #9: never offset). `category: 'all'` spans every category. `cursor` is
 * the last page's `nextCursor`; pass null/undefined for the first page.
 */
export async function getFeedPage(
  client: AthanorClient,
  opts: { category: PostCategory | 'all'; cursor?: FeedCursor | null; limit?: number } = {
    category: 'all',
  },
): Promise<FeedPage> {
  const limit = opts.limit ?? FEED_PAGE_SIZE;
  let query = client
    .from('posts')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (opts.category !== 'all') query = query.eq('category', opts.category);

  // keyset: (created_at, id) < (cursor.created_at, cursor.id), expressed for PostgREST
  if (opts.cursor) {
    const { created_at, id } = opts.cursor;
    query = query.or(`created_at.lt.${created_at},and(created_at.eq.${created_at},id.lt.${id})`);
  }

  const { data, error } = await query;
  if (error) throw error;
  const posts = (data ?? []).map((row) => postSchema.parse(row));
  // A full page means more rows may exist — hand back the last row as the keyset cursor.
  const last = posts.length === limit ? posts.at(-1) : undefined;
  const nextCursor = last ? { created_at: last.created_at, id: last.id } : null;
  return { posts, nextCursor };
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
 */
export async function createPost(client: AthanorClient, insert: PostInsert): Promise<Post> {
  const payload = postInsertSchema.parse(insert);
  const { data, error } = await client.from('posts').insert(payload).select('*').single();
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
    .channel('public:posts:insert')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, (payload) => {
      const parsed = postSchema.safeParse(payload.new);
      if (parsed.success) onInsert(parsed.data);
    })
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
