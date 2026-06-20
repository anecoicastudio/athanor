import { z } from 'zod';

/** Stripe Identity session statuses — mirrors the verifications.status CHECK (backend 06 §2.8). */
export const VERIFICATION_STATUSES = ['pending', 'verified', 'failed'] as const;

/**
 * A row of `public.verifications` — a cache of one Stripe Identity VerificationSession.
 * Server-only writes (no client insert/update schema): the client reads its own sessions
 * and never sets `status` (rule #6). The +50 Aura is the M6 engine's job (rule #1).
 */
export const verificationSchema = z.object({
  id: z.string().uuid(),
  profile_id: z.string().uuid(),
  stripe_session_id: z.string(),
  status: z.enum(VERIFICATION_STATUSES),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Verification = z.infer<typeof verificationSchema>;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
