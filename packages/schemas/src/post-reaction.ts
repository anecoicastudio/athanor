import { z } from 'zod';

// Mirrors supabase/migrations/20260614184557_community_post_reactions.sql (schemas mirror
// migrations). Write-boundary shape only: the ✦ toggle inserts this pair; created_at and id
// are server-defaulted, and RLS WITH CHECK re-verifies person_id = auth.uid(). The full row
// model was deleted unread in #272.
export const postReactionInsertSchema = z.object({
  post_id: z.string().uuid(),
  person_id: z.string().uuid(),
});
export type PostReactionInsert = z.infer<typeof postReactionInsertSchema>;
