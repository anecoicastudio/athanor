import {
  type Message,
  type MessageInsert,
  messageInsertSchema,
  messageSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';
import { keysetFilter, nextCursorOf } from './pagination';
import { channelTopic } from './realtime';

export const messageKeys = {
  all: ['messages'] as const,
  thread: (conversationId: string) => [...messageKeys.all, 'thread', conversationId] as const,
};

/** Opaque keyset cursor — the last (created_at, id) seen. Never an offset (rule #9). */
export type MessageCursor = { created_at: string; id: string };
export type MessagePage = { messages: Message[]; nextCursor: MessageCursor | null };

const MESSAGE_PAGE_SIZE = 30;

/**
 * One page of a thread, newest-first by the (created_at, id) keyset (rule #9). The screen
 * reverses pages into chronological order. RLS restricts to participants.
 */
export async function getMessagesPage(
  client: AthanorClient,
  opts: { conversationId: string; cursor?: MessageCursor | null; limit?: number },
): Promise<MessagePage> {
  const limit = opts.limit ?? MESSAGE_PAGE_SIZE;
  let query = client
    .from('messages')
    .select('*')
    .eq('conversation_id', opts.conversationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (opts.cursor) {
    const { created_at, id } = opts.cursor;
    query = query.or(keysetFilter('created_at', 'id', created_at, id, 'lt'));
  }

  const { data, error } = await query;
  if (error) throw error;
  const messages = (data ?? []).map((row) => messageSchema.parse(row));
  const nextCursor = nextCursorOf(messages, limit, (last) => ({
    created_at: last.created_at,
    id: last.id,
  }));
  return { messages, nextCursor };
}

/**
 * Send a user message: text, an image, or both (#155). `sender_id` is the caller's uid (RLS
 * re-checks it; kind is pinned to 'user' by the insert policy). `mediaUrl` is a chat-media
 * storage KEY ({sender}/{conversation}/{id}.jpg) whose bytes must already be uploaded — the
 * client holds no UPDATE grant on messages, so there is no attach-after-insert. Pass `body`
 * only when it is non-blank; an image-only send omits it. Recording the message is the M6 +5
 * domain signal — this writes only `messages`, never aura (rule #1). TODO(M6): the engine
 * award at ≥10 msgs both sides.
 */
export async function sendMessage(
  client: AthanorClient,
  input: { conversationId: string; senderId: string; body?: string; mediaUrl?: string },
): Promise<Message> {
  const payload: MessageInsert = messageInsertSchema.parse({
    conversation_id: input.conversationId,
    sender_id: input.senderId,
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.mediaUrl !== undefined ? { media_url: input.mediaUrl } : {}),
  });
  const { data, error } = await client
    .from('messages')
    .insert({ ...payload, kind: 'user' })
    .select('*')
    .single();
  if (error) throw error;
  return messageSchema.parse(data);
}

/**
 * Subscribe to new messages in one conversation (realtime C4, postgres_changes INSERT filtered
 * by conversation_id; RLS gives non-participants nothing). Returns a cleanup fn (api.md).
 */
export function subscribeMessages(
  client: AthanorClient,
  conversationId: string,
  onInsert: (message: Message) => void,
): () => void {
  const channel = client
    .channel(channelTopic(`conversation:${conversationId}:messages`))
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        const parsed = messageSchema.safeParse(payload.new);
        if (parsed.success) onInsert(parsed.data);
      },
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
