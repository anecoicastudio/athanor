import { z } from 'zod';

/** Mirrors supabase/migrations story_reactions. One ✦ per (segment, person). */
export const storyReactionSchema = z.object({
  id: z.string().uuid(),
  segment_id: z.string().uuid(),
  person_id: z.string().uuid(),
  created_at: z.string(),
});

/** Celebrating a step — segment_id + person_id (the caller's auth uid; RLS re-checks). */
export const storyReactionInsertSchema = storyReactionSchema.pick({
  segment_id: true,
  person_id: true,
});

export type StoryReaction = z.infer<typeof storyReactionSchema>;
export type StoryReactionInsert = z.infer<typeof storyReactionInsertSchema>;
