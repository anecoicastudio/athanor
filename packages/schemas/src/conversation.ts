import { z } from 'zod';
import { avatarPathSchema, displayNameSchema, peerIdentityFields } from './profile.ts';

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
  // #637: who wrote the message that set last_message_at. Nullable for a conversation whose only
  // rows are the ice-breakers (kind 'system'/'prompt' never bump), and for one whose last sender
  // has since been erased — the FK is ON DELETE SET NULL.
  last_message_sender_id: z.string().uuid().nullable(),
  // The caller's OWN read cursor, embedded. It is an array because the FK is one-to-many, but RLS
  // (`conversation_reads_select_own`) makes it hold at most the caller's row — the filtering is
  // the policy's, not a query clause anyone can forget. `.nullish()` for the M6 nullish trap.
  conversation_reads: z.array(z.object({ last_read_at: z.string() })).nullish(),
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
  // DERIVED, never stored (#637): the last message is newer than my cursor AND somebody else
  // wrote it. Computed in the query rather than carried on a row, so a refetch is all it takes to
  // settle — which is what lets the realtime subscription stay payload-free.
  unread: z.boolean(),
});
export type ConversationListItem = z.infer<typeof conversationListItem>;
