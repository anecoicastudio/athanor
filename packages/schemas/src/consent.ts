import { z } from 'zod';

// Mirrors supabase/migrations/20260620122139_m9_consent.sql (06 §2.13). One row per (profile_id, kind).
// The «dati non venduti» guarantee is constitutional — it has NO row here (not a toggle).
export const CONSENT_KINDS = ['comms', 'analytics', 'location_approx'] as const;
export const consentKind = z.enum(CONSENT_KINDS);
export type ConsentKind = z.infer<typeof consentKind>;

export const CONSENT_SOURCES = ['signup', 'settings'] as const;
export const consentSource = z.enum(CONSENT_SOURCES);
export type ConsentSource = z.infer<typeof consentSource>;

// Owner CRUD-minus-delete.
export const consentSchema = z.object({
  id: z.string().uuid(),
  profile_id: z.string().uuid(),
  kind: consentKind,
  granted: z.boolean(),
  granted_at: z.string(),
  source: consentSource,
  created_at: z.string(),
  updated_at: z.string(),
});
export type Consent = z.infer<typeof consentSchema>;

// Upsert input (the consent toggle): {kind, granted, source}. profile_id is set server-side from the session.
export const setConsentInput = consentSchema.pick({ kind: true, granted: true, source: true });
export type SetConsentInput = z.infer<typeof setConsentInput>;
