import {
  type Block,
  blockInput,
  blockSchema,
  type BlockedListItem,
  blockedListItem,
} from '@athanor/schemas';
import type { AthanorClient } from './client';
import { keysetFilter } from './pagination';

export const blockKeys = {
  all: ['blocks'] as const,
  list: () => [...blockKeys.all, 'list'] as const,
  count: () => [...blockKeys.all, 'count'] as const,
  status: (peerId: string) => [...blockKeys.all, 'status', peerId] as const,
};

const PAGE = 30;

/** Block a person. blocker_id defaults to auth.uid(); RLS WITH CHECK enforces ownership. */
export async function blockUser(client: AthanorClient, blockedId: string): Promise<Block> {
  const input = blockInput.parse({ blockedId });
  const { data, error } = await client
    .from('blocks')
    .insert({ blocked_id: input.blockedId })
    .select('*')
    .single();
  if (error) throw error;
  return blockSchema.parse(data);
}

/** Unblock — hard delete the own block row targeting `blockedId` (RLS scopes to blocker_id=auth.uid()). */
export async function unblockUser(client: AthanorClient, blockedId: string): Promise<void> {
  const { error } = await client.from('blocks').delete().eq('blocked_id', blockedId);
  if (error) throw error;
}

/** True when the caller currently blocks `peerId`. */
export async function getBlockStatus(client: AthanorClient, peerId: string): Promise<boolean> {
  const { data, error } = await client
    .from('blocks')
    .select('id')
    .eq('blocked_id', peerId)
    .maybeSingle();
  if (error) throw error;
  return data != null;
}

/** Owner-private count for the Settings subtitle (never a public vanity metric, rule #3). */
export async function getBlockedCount(client: AthanorClient): Promise<number> {
  const { count, error } = await client.from('blocks').select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

/** The caller's blocked people, keyset-paginated (created_at desc, id desc) — never offset (rule #9). */
export async function listBlocked(
  client: AthanorClient,
  cursor?: { createdAt: string; id: string },
): Promise<BlockedListItem[]> {
  let q = client
    .from('blocks')
    .select('id, blocked_id, created_at, blocked:profiles!blocks_blocked_id_fkey(handle)')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE);
  if (cursor) {
    q = q.or(keysetFilter('created_at', 'id', cursor.createdAt, cursor.id, 'lt'));
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) =>
    blockedListItem.parse({
      id: r.id,
      peerId: r.blocked_id,
      peerHandle: (r.blocked as { handle: string | null } | null)?.handle ?? null,
      createdAt: r.created_at,
    }),
  );
}

export type { Block, BlockedListItem };
