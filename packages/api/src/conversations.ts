import {
  type ConversationListItem,
  type ConversationPeerRow,
  conversationListItem,
  conversationPeerRow,
} from '@athanor/schemas';
import type { AthanorClient } from './client';
import { keysetFilter, nextCursorOf } from './pagination';
import { channelTopic } from './realtime';

export const conversationKeys = {
  all: ['conversations'] as const,
  list: () => [...conversationKeys.all, 'list'] as const,
  detail: (id: string) => [...conversationKeys.all, 'detail', id] as const,
};

/** Opaque keyset cursor — the last (last_message_at, id) seen. Never an offset (rule #9). */
export type ConversationCursor = { last_message_at: string; id: string };
export type ConversationListPage = {
  items: ConversationListItem[];
  nextCursor: ConversationCursor | null;
};

const CONV_PAGE_SIZE = 20;

const PEER_SELECT =
  'id, participant_a, participant_b, last_message_at, last_message_preview, ' +
  'a:profiles!conversations_participant_a_fkey(handle, display_name, avatar_path), ' +
  'b:profiles!conversations_participant_b_fkey(handle, display_name, avatar_path)';

/** Parse one wire row, then resolve it to the peer (the participant that isn't me). */
function rowToListItem(raw: unknown, myId: string): ConversationListItem {
  const row: ConversationPeerRow = conversationPeerRow.parse(raw);
  const peerIsA = row.participant_a !== myId;
  const peer = peerIsA ? row.a : row.b;
  return conversationListItem.parse({
    id: row.id,
    peerId: peerIsA ? row.participant_a : row.participant_b,
    peerHandle: peer?.handle ?? null,
    peerDisplayName: peer?.display_name ?? null,
    peerAvatarPath: peer?.avatar_path ?? null,
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview,
  });
}

/**
 * One page of the caller's conversations, newest-activity first by the (last_message_at, id)
 * keyset (rule #9: never offset). RLS scopes to the caller's own conversations.
 */
export async function getConversationsPage(
  client: AthanorClient,
  opts: { cursor?: ConversationCursor | null; limit?: number } = {},
): Promise<ConversationListPage> {
  const myId = (await client.auth.getUser()).data.user?.id;
  if (!myId) return { items: [], nextCursor: null };
  const limit = opts.limit ?? CONV_PAGE_SIZE;
  let query = client
    .from('conversations')
    .select(PEER_SELECT)
    .order('last_message_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (opts.cursor) {
    const { last_message_at, id } = opts.cursor;
    query = query.or(keysetFilter('last_message_at', 'id', last_message_at, id, 'lt'));
  }

  const { data, error } = await query;
  if (error) throw error;
  const items = (data ?? []).map((r) => rowToListItem(r, myId));
  const nextCursor = nextCursorOf(items, limit, (last) => ({
    last_message_at: last.lastMessageAt,
    id: last.id,
  }));
  return { items, nextCursor };
}

/** One conversation resolved to its peer (for the chat header). null if not found / not a member. */
export async function getConversation(
  client: AthanorClient,
  id: string,
): Promise<ConversationListItem | null> {
  const myId = (await client.auth.getUser()).data.user?.id;
  if (!myId) return null;
  const { data, error } = await client
    .from('conversations')
    .select(PEER_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToListItem(data, myId) : null;
}

/**
 * The «Scrivi» / open-or-create path. Returns the conversation id; the server RPC
 * canonicalizes the pair and is idempotent (a 'direct' conversation starts empty).
 */
export async function getOrCreateConversation(
  client: AthanorClient,
  peerId: string,
): Promise<string> {
  const { data, error } = await client.rpc('get_or_create_conversation', { peer_id: peerId });
  if (error) throw error;
  return data;
}

/**
 * Subscribe to changes on the caller's conversations (realtime C5). No client filter —
 * RLS scopes to the caller. Fires onChange for INSERT/UPDATE (new match, last_message_at bump);
 * the caller refetches the list. Returns a cleanup fn — call it on unmount (api.md).
 */
export function subscribeConversations(client: AthanorClient, onChange: () => void): () => void {
  const channel = client
    .channel(channelTopic('conversations:mine'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () =>
      onChange(),
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
