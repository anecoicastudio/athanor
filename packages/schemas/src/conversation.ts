import { z } from 'zod';
import { avatarPathSchema, displayNameSchema, peerIdentityFields } from './profile';

/** What each aliased `profiles` embed selects — one shape, so a/b cannot drift apart. */
const peerEmbed = z.object({
  handle: z.string().nullable(),
  display_name: displayNameSchema.nullable(),
  avatar_path: avatarPathSchema.nullable(),
});

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
  a: peerEmbed.nullable(),
  b: peerEmbed.nullable(),
});
export type ConversationPeerRow = z.infer<typeof conversationPeerRow>;

// Messages-list read model (camelCase): a conversation resolved to its peer (the non-me participant).
export const conversationListItem = z.object({
  id: z.string().uuid(),
  peerId: z.string().uuid(),
  ...peerIdentityFields,
  lastMessageAt: z.string(),
  lastMessagePreview: z.string().nullable(),
});
export type ConversationListItem = z.infer<typeof conversationListItem>;
