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

export const dreamInsertSchema = dreamSchema.pick({ profile_id: true, text: true });

export type Dream = z.infer<typeof dreamSchema>;
export type DreamInsert = z.infer<typeof dreamInsertSchema>;
