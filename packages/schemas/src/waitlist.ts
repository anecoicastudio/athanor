import { z } from 'zod';
import { localeSchema } from './profile';

/**
 * Joining the waitlist — the single write boundary. Email is normalized here
 * (trim + lowercase) so the unique index dedupes case/space variants; `source`
 * tags where the signup happened (e.g. 'landing-hero'). locale defaults to 'it'.
 */
export const waitlistInsertSchema = z.object({
  email: z.string().trim().toLowerCase().email('invalid email').max(320),
  locale: localeSchema.default('it'),
  source: z.string().max(80).optional(),
});

export type WaitlistInsert = z.infer<typeof waitlistInsertSchema>;

/**
 * A waitlist row as the admin panel and the CSV export read it — the projection of the
 * `admin_list_waitlist` RPC (migration 20260821085655), parsed at the boundary rather than
 * cast. `id` is in the row because it is the keyset tie-break (#335). `source` is nullable
 * here even though the RPC's declared return type cannot say so — the column is.
 *
 * Not `waitlistInsertSchema.extend(...)`: that schema normalises INPUT (trim, lowercase,
 * `.email()`), and a stored row is evidence, not input. Re-validating the address shape on
 * the way out would withhold a signup the database accepted, which on an export is the
 * failure that looks like a smaller list.
 */
export const waitlistAdminRowSchema = z.object({
  id: z.string().uuid(),
  email: z.string().min(3).max(320),
  locale: localeSchema,
  source: z.string().nullable(),
  created_at: z.string(),
});
export type WaitlistAdminRow = z.infer<typeof waitlistAdminRowSchema>;
