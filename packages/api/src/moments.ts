import { type Moment, type MomentInsert, momentInsertSchema, momentSchema } from '@athanor/schemas';
import type { AthanorClient } from './client';
import { keysetFilter, nextCursorOf } from './pagination';

export const momentKeys = {
  all: ['moments'] as const,
  list: (ownerId: string) => ['moments', 'list', ownerId] as const,
};

export type MomentCursor = { created_at: string; id: string };
export type MomentPage = { moments: Moment[]; nextCursor: MomentCursor | null };
const PAGE_SIZE = 24;

/** One page of a person's live moments, newest-first by (created_at, id) keyset (rule #9, never offset). */
export async function getMomentsPage(
  client: AthanorClient,
  ownerId: string,
  cursor?: MomentCursor | null,
  limit = PAGE_SIZE,
): Promise<MomentPage> {
  let q = client
    .from('moments')
    .select('*')
    .eq('owner_id', ownerId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (cursor) {
    q = q.or(keysetFilter('created_at', 'id', cursor.created_at, cursor.id, 'lt'));
  }
  const { data, error } = await q;
  if (error) throw error;
  const moments = (data ?? []).map((row) => momentSchema.parse(row));
  return {
    moments,
    nextCursor: nextCursorOf(moments, limit, (last) => ({
      created_at: last.created_at,
      id: last.id,
    })),
  };
}

/** Create a moment row (owner-only via RLS). Bytes uploaded to the moments bucket first. */
export async function createMoment(client: AthanorClient, insert: MomentInsert): Promise<Moment> {
  const payload = momentInsertSchema.parse(insert);
  const { data, error } = await client.from('moments').insert(payload).select('*').single();
  if (error) throw error;
  return momentSchema.parse(data);
}

/**
 * Soft-delete an own moment (owner UPDATE policy). Idempotent. Flips `deleted_at`
 * only — the row vanishes from every read (RLS filters `deleted_at is null`). The
 * Storage bytes are NOT removed here; callers that own the path should best-effort
 * `storage.from('moments').remove([media_path])` (owner delete policy allows it),
 * and the M9 GDPR erasure job is the backstop reaper for any orphaned objects.
 */
export async function softDeleteMoment(client: AthanorClient, id: string): Promise<void> {
  const { error } = await client
    .from('moments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null);
  if (error) throw error;
}
