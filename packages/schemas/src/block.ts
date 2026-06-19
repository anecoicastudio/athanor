import { z } from 'zod';

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

// Blocked-list read model (camelCase): the block row resolved to the blocked person.
export const blockedListItem = z.object({
  id: z.string().uuid(), // the block row id
  peerId: z.string().uuid(), // blocked_id
  peerHandle: z.string().nullable(),
  createdAt: z.string(),
});
export type BlockedListItem = z.infer<typeof blockedListItem>;
