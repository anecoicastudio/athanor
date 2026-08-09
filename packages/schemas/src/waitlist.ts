import { z } from 'zod';

/** Mirrors supabase/migrations email_waitlist. Update both together. */
export const waitlistEntrySchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().max(320),
  locale: z.enum(['it', 'en']),
  source: z.string().max(80).nullable(),
  created_at: z.string(),
});

/**
 * Joining the waitlist — the single write boundary. Email is normalized here
 * (trim + lowercase) so the unique index dedupes case/space variants; `source`
 * tags where the signup happened (e.g. 'landing-hero'). locale defaults to 'it'.
 */
export const waitlistInsertSchema = z.object({
  email: z.string().trim().toLowerCase().email('invalid email').max(320),
  locale: z.enum(['it', 'en']).default('it'),
  source: z.string().max(80).optional(),
});

export type WaitlistEntry = z.infer<typeof waitlistEntrySchema>;
export type WaitlistInsert = z.infer<typeof waitlistInsertSchema>;
