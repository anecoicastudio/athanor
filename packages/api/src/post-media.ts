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
 * Make a post's media rows be EXACTLY `rows` (author-only via RLS). Bytes must be uploaded to
 * the post-media bucket first. Writing media does not write Aura (rule #1); the +6 post event
 * is emitted at post creation (TODO(M6)).
 *
 * The set-replacing counterpart of `createPost`'s converge, and it exists for the same retry
 * (#586). The composer mints the post id, so a second publish attempt after a lost response
 * can meet a post that already carries the FIRST attempt's media. An insert-only write had no
 * answer to that: it is ONE batch statement, so a single collision on
 * `post_media_post_position` aborts the whole thing and none of the second attempt's rows
 * land — while the retry's uploads have already overwritten the bytes underneath them,
 * because the storage key is `{uid}/{postId}/{position}.{ext}` and only the SHARED positions
 * holding the same kind collide. What survived was a row whose dimensions describe one file
 * and whose key now holds another, a position whose kind changed pointing at its old intact
 * byte, and — either a tail of rows the shorter new set no longer fills, or, for a LONGER new
 * set, bytes at the new positions with no row at all.
 *
 * Two statements, in this order:
 *
 * 1. UPSERT on `post_media_post_position` — the (post_id, position) unique index, NOT the
 *    primary key. `postMediaInsertSchema` carries no `id`, so the default conflict target
 *    would make every row new and hand the retry back the 23505 this exists to stop. Every
 *    column of the insert schema is in the payload, so a surviving row is rewritten whole:
 *    kind, path, poster, dimensions, duration.
 * 2. DELETE every remaining row of the post whose position the new set does not fill. An
 *    EMPTY set deletes them all — that is the case an `if (rows.length > 0)` guard at the call
 *    site can never see, and it is what a member who removed every attachment between the two
 *    taps is asking for.
 *
 * Upsert first, delete second. The reverse order opens a window in which the post exists,
 * claims media through its `type`, and has none — #579's defect, deliberately. The two are not
 * one transaction (PostgREST has no client-side transaction), so a failure between them leaves
 * the old tail in place: what the caller already had, and what the next retry removes.
 * Closing that window entirely would take an RPC and a migration; the state it can leave is
 * strictly narrower than the state it replaces.
 *
 * The sweep therefore rethrows, and the cost of that is worth naming: it is a statement that
 * can fail with NOTHING to do. A retry whose first attempt landed completely converges on the
 * upsert and then sweeps zero rows — and if that empty DELETE drops on a flaky connection the
 * caller is told the publish failed when the post and its media are already exactly right.
 * The trade is deliberate and one-sided: a false failure costs one more tap on a path that is
 * idempotent by construction, where swallowing it would report success over a set still
 * carrying rows the member deleted, which nothing afterwards corrects.
 *
 * The BYTES are not swept. Objects the previous set uploaded and this one does not reference
 * stay in `post-media`, the same trade the composer already makes for an abandoned draft.
 * Erasure still reaches them — `gdpr_storage_footprint` sweeps the bucket by `{uid}/` prefix.
 *
 * Author-only on every verb it uses, by RLS: `post_media_update_post_author` (USING and WITH
 * CHECK) and `post_media_delete_post_author` both resolve the parent post's `author_id`, and
 * #106's restrictive `active_write_update` / `active_write_delete` gate them like any other
 * write. `supabase/tests/0012_post_media_rls.test.sql` asserts both directions.
 */
export async function replacePostMedia(
  client: AthanorClient,
  postId: string,
  rows: PostMediaInsert[],
): Promise<PostMedia[]> {
  const payload = rows.map((r) => postMediaInsertSchema.parse(r));

  // Both guards refuse BEFORE any statement is sent, because both would otherwise be
  // destructive rather than merely wrong: a row carrying another post's id would be upserted
  // onto that post while the delete swept this one, and a repeated position is the one input
  // ON CONFLICT cannot take — Postgres refuses to affect a row twice in the same command, and
  // does it with a message about the statement rather than about the caller's set.
  const foreign = payload.find((r) => r.post_id !== postId);
  if (foreign) {
    throw new Error(`replacePostMedia: a row for post ${foreign.post_id} in the set for ${postId}`);
  }
  const positions = payload.map((r) => r.position);
  if (new Set(positions).size !== positions.length) {
    throw new Error(`replacePostMedia: two rows share a position in the set for ${postId}`);
  }

  let kept: PostMedia[] = [];
  if (payload.length > 0) {
    const { data, error } = await client
      .from('post_media')
      .upsert(payload, { onConflict: 'post_id,position' })
      .select('*');
    if (error) throw error;
    kept = (data ?? []).map((row) => postMediaSchema.parse(row));
  }

  let stale = client.from('post_media').delete().eq('post_id', postId);
  if (positions.length > 0) stale = stale.not('position', 'in', `(${positions.join(',')})`);
  const { error } = await stale;
  if (error) throw error;

  // PostgREST returns an upsert's rows in no defined order; callers reading this expect the
  // order the post renders in, which is `getPostMedia`'s.
  return kept.sort((a, b) => a.position - b.position);
}
