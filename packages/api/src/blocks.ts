import {
  type Block,
  blockInput,
  blockSchema,
  type BlockedListItem,
  blockedListItem,
  listBlockedRow,
} from '@athanor/schemas';
import type { AthanorClient } from './client';
import { parseOrWithhold } from './parse-or-withhold';

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

/**
 * The caller's blocked people, keyset-paginated (created_at desc, id desc) — never offset (rule #9).
 *
 * Through the `list_blocked` DEFINER RPC rather than a `blocks → profiles` embed (#663): the
 * profiles SELECT policy composes the SYMMETRIC `athanor.not_blocked`, which hides the blocked
 * person's row from the blocker too, so the embed came back NULL and every row rendered «—».
 * The RPC is scoped server-side to `blocker_id = auth.uid()`; nothing here names the caller.
 *
 * A blocked person who has since been banned arrives as the #314 tombstone (identity NULL,
 * `removed` true). Rows the schema no longer recognises are withheld and counted, not thrown
 * on — a list stays up over one bad row (api.md, #421).
 */
export async function listBlocked(
  client: AthanorClient,
  cursor?: { createdAt: string; id: string },
): Promise<{ items: BlockedListItem[]; excluded: number }> {
  const { data, error } = await client.rpc('list_blocked', {
    p_limit: PAGE,
    ...(cursor ? { p_before_created_at: cursor.createdAt, p_before_id: cursor.id } : {}),
  });
  if (error) throw error;
  const { parsed, excluded } = parseOrWithhold(data, listBlockedRow, 'blocks', 'the blocked list');
  const items = parsed.map((r) =>
    blockedListItem.parse({
      id: r.id,
      peerId: r.blocked_id,
      peerHandle: r.handle,
      peerDisplayName: r.display_name,
      peerAvatarPath: r.avatar_path,
      removed: r.removed,
      createdAt: r.created_at,
    }),
  );
  return { items, excluded };
}

export type { Block, BlockedListItem };
