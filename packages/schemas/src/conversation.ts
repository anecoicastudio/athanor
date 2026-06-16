import { z } from 'zod';

// Mirrors supabase/migrations/<ts>_conversations_messages.sql (schemas mirror migrations).
export const conversationSource = z.enum(['momento', 'direct']);
export type ConversationSource = z.infer<typeof conversationSource>;

// Raw-row model (snake_case): parsed directly off select('*') and realtime payload.new.
export const conversationSchema = z.object({
  id: z.string().uuid(),
  participant_a: z.string().uuid(),
  participant_b: z.string().uuid(),
  created_from: conversationSource,
  last_message_at: z.string(),
  last_message_preview: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Conversation = z.infer<typeof conversationSchema>;

// Messages-list read model (camelCase): a conversation resolved to its peer (the non-me participant).
export const conversationListItem = z.object({
  id: z.string().uuid(),
  peerId: z.string().uuid(),
  peerHandle: z.string().nullable(),
  lastMessageAt: z.string(),
  lastMessagePreview: z.string().nullable(),
});
export type ConversationListItem = z.infer<typeof conversationListItem>;
