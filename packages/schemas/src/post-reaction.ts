import { z } from 'zod';

/** Mirrors supabase/migrations community_post_reactions. One ✦ per (post, person). */
export const postReactionSchema = z.object({
  id: z.string().uuid(),
  post_id: z.string().uuid(),
  person_id: z.string().uuid(),
  created_at: z.string(),
});

/** Lighting a star — post_id + person_id (the caller's auth uid; RLS re-checks). */
export const postReactionInsertSchema = postReactionSchema.pick({ post_id: true, person_id: true });

export type PostReaction = z.infer<typeof postReactionSchema>;
export type PostReactionInsert = z.infer<typeof postReactionInsertSchema>;
