import { z } from 'zod';
import { nonBlankString, trimmedNonBlank } from './primitives';

/** Mirrors supabase/migrations onboarding_identity + dreams_constraints. Update both together. */
export const dreamSchema = z.object({
  id: z.string().uuid(),
  profile_id: z.string().uuid(),
  text: nonBlankString(500, 'dream text must not be blank'),
  status: z.enum(['active', 'archived']),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});

/** Shared write-path rule for dream text: trim, then 1–500 chars. */
const dreamTextSchema = trimmedNonBlank(500, 'dream text must not be blank');

export const dreamInsertSchema = dreamSchema
  .pick({ profile_id: true })
  .extend({ text: dreamTextSchema });

/** Editing the single active dream — text only; trims then enforces 1–500 chars. */
export const dreamUpdateSchema = z.object({ text: dreamTextSchema });

export type Dream = z.infer<typeof dreamSchema>;
export type DreamInsert = z.infer<typeof dreamInsertSchema>;
export type DreamUpdate = z.infer<typeof dreamUpdateSchema>;
