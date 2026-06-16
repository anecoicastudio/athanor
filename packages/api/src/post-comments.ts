import {
  type PostComment,
  type PostCommentInsert,
  postCommentInsertSchema,
  postCommentSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

/** Opaque keyset cursor — the last (created_at, id) the caller has seen. Never an offset. */
export type CommentCursor = { created_at: string; id: string };
export type CommentPage = { comments: PostComment[]; nextCursor: CommentCursor | null };

const COMMENT_PAGE_SIZE = 20;

/**
 * One page of a post's comment thread, newest-first by the (created_at, id) keyset
 * (rule #9: never offset). `cursor` is the last page's `nextCursor`; null for the first.
 */
export async function getCommentsPage(
  client: AthanorClient,
  opts: { postId: string; cursor?: CommentCursor | null; limit?: number },
): Promise<CommentPage> {
  const limit = opts.limit ?? COMMENT_PAGE_SIZE;
  let query = client
    .from('post_comments')
    .select('*')
    .eq('post_id', opts.postId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (opts.cursor) {
    const { created_at, id } = opts.cursor;
    query = query.or(`created_at.lt.${created_at},and(created_at.eq.${created_at},id.lt.${id})`);
  }

  const { data, error } = await query;
  if (error) throw error;
  const comments = (data ?? []).map((row) => postCommentSchema.parse(row));
  // A full page means more rows may exist — hand back the last row as the keyset cursor.
  const last = comments.length === limit ? comments.at(-1) : undefined;
  const nextCursor = last ? { created_at: last.created_at, id: last.id } : null;
  return { comments, nextCursor };
}

/**
 * Add a comment (optionally a reply via parent_id). `author_id` is the caller's
 * auth uid — RLS re-checks it. Posting a comment is the M6 +2 domain event; this
 * writes only `post_comments`, never aura (rule #1). TODO(M6): the engine award.
 */
export async function addComment(
  client: AthanorClient,
  insert: PostCommentInsert,
): Promise<PostComment> {
  const payload = postCommentInsertSchema.parse(insert);
  const { data, error } = await client.from('post_comments').insert(payload).select('*').single();
  if (error) throw error;
  return postCommentSchema.parse(data);
}

/** Soft-delete an own comment (owner UPDATE policy; no hard delete). Idempotent. */
export async function softDeleteComment(client: AthanorClient, id: string): Promise<void> {
  const { error } = await client
    .from('post_comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null);
  if (error) throw error;
}

/**
 * Subscribe to new comments on one post (realtime INSERT) for live append on the
 * open post detail. Returns a cleanup fn — callers MUST call it on unmount (rule api.md).
 */
export function subscribeComments(
  client: AthanorClient,
  postId: string,
  onInsert: (comment: PostComment) => void,
): () => void {
  const channel = client
    .channel(`public:post_comments:${postId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'post_comments', filter: `post_id=eq.${postId}` },
      (payload) => {
        const parsed = postCommentSchema.safeParse(payload.new);
        if (parsed.success) onInsert(parsed.data);
      },
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
