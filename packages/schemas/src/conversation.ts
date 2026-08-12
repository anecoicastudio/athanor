import { z } from 'zod';

// Messages-list read model (camelCase): a conversation resolved to its peer (the non-me participant).
export const conversationListItem = z.object({
  id: z.string().uuid(),
  peerId: z.string().uuid(),
  peerHandle: z.string().nullable(),
  lastMessageAt: z.string(),
  lastMessagePreview: z.string().nullable(),
});
export type ConversationListItem = z.infer<typeof conversationListItem>;
