import { z } from 'zod';
import { avatarPathSchema, displayNameSchema, peerIdentityFields } from './profile.ts';

// Mirrors supabase/migrations/<ts>_m9_blocks_and_not_blocked.sql (06 §2.10).
// Immutable table — no updated_at / deleted_at (unblock is a hard DELETE).
export const blockSchema = z.object({
  id: z.string().uuid(),
  blocker_id: z.string().uuid(),
  blocked_id: z.string().uuid(),
  created_at: z.string(),
});
export type Block = z.infer<typeof blockSchema>;

// Insert input — only the target. blocker_id defaults to auth.uid() server-side; RLS WITH CHECK enforces it.
export const blockInput = z.object({
  blockedId: z.string().uuid(),
});
export type BlockInput = z.infer<typeof blockInput>;

// One row of the `list_blocked` RPC (supabase/migrations/20260903083235_list_blocked_rpc.sql).
// The blocker's own ledger read through a DEFINER channel, because the profiles policy composes
// the SYMMETRIC athanor.not_blocked and hides the blocked row from the blocker too (#663). A
// BANNED blocked person arrives as the #314 tombstone: identity NULL, `removed` true.
export const listBlockedRow = z.object({
  id: z.string().uuid(),
  blocked_id: z.string().uuid(),
  created_at: z.string(),
  // Same looseness as peerIdentityFields on the handle (a read model renders an off-pattern
  // handle rather than throwing), and the same two identity schemas on the rest — so the
  // boundary parse is never looser than the read model it feeds, or a row would clear
  // parseOrWithhold and then throw in blockedListItem.parse, outside the withhold.
  handle: z.string().nullable(),
  display_name: displayNameSchema.nullable(),
  avatar_path: avatarPathSchema.nullable(),
  removed: z.boolean(),
});
export type ListBlockedRow = z.infer<typeof listBlockedRow>;

// Blocked-list read model (camelCase): the block row resolved to the blocked person.
export const blockedListItem = z.object({
  id: z.string().uuid(), // the block row id
  peerId: z.string().uuid(), // blocked_id
  ...peerIdentityFields,
  // The #314 tombstone: the blocked person has since been banned. Identity fields are NULL and
  // the row renders «account removed» rather than the missing-profile «—».
  removed: z.boolean(),
  createdAt: z.string(),
});
export type BlockedListItem = z.infer<typeof blockedListItem>;
