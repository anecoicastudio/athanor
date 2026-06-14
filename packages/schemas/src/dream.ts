import { z } from 'zod';

/** Mirrors supabase/migrations onboarding_identity + dreams_constraints. Update both together. */
export const dreamSchema = z.object({
  id: z.string().uuid(),
  profile_id: z.string().uuid(),
  text: z
    .string()
    .max(500)
    .refine((value) => value.trim().length > 0, 'dream text must not be blank'),
  status: z.enum(['active', 'archived']),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});

/** Shared write-path rule for dream text: trim, then 1–500 chars. */
const dreamTextSchema = z.string().trim().min(1, 'dream text must not be blank').max(500);

export const dreamInsertSchema = dreamSchema
  .pick({ profile_id: true })
  .extend({ text: dreamTextSchema });

/** Editing the single active dream — text only; trims then enforces 1–500 chars. */
export const dreamUpdateSchema = z.object({ text: dreamTextSchema });

export type Dream = z.infer<typeof dreamSchema>;
export type DreamInsert = z.infer<typeof dreamInsertSchema>;
export type DreamUpdate = z.infer<typeof dreamUpdateSchema>;
