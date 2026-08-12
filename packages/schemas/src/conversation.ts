import { z } from 'zod';

/**
 * The wire shape of the conversations-with-peer-handles select, parsed at the boundary.
 *
 * Two aliased embeds off the same table (a/b → profiles via the two participant FKs) is
 * exactly the shape supabase-js cannot infer, so this schema — not a hand-written type
 * behind a cast — is what makes the row typed.
 */
export const conversationPeerRow = z.object({
  id: z.string().uuid(),
  participant_a: z.string().uuid(),
  participant_b: z.string().uuid(),
  last_message_at: z.string(),
  last_message_preview: z.string().nullable(),
  a: z.object({ handle: z.string().nullable() }).nullable(),
  b: z.object({ handle: z.string().nullable() }).nullable(),
});
export type ConversationPeerRow = z.infer<typeof conversationPeerRow>;

// Messages-list read model (camelCase): a conversation resolved to its peer (the non-me participant).
export const conversationListItem = z.object({
  id: z.string().uuid(),
  peerId: z.string().uuid(),
  peerHandle: z.string().nullable(),
  lastMessageAt: z.string(),
  lastMessagePreview: z.string().nullable(),
});
export type ConversationListItem = z.infer<typeof conversationListItem>;
