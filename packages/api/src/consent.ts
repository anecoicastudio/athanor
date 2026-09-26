import { CONSENT_KINDS, type Consent, type SetConsentInput, consentSchema } from '@athanor/schemas';
import type { AthanorClient } from './client';

// gdprKeys covers the GDPR surface query factory (consent records + export-job status).
export const gdprKeys = {
  all: ['gdpr'] as const,
  // Scoped by profile id: the consent cache is persisted, so an unscoped key would let a
  // second account (on the same device, post-switch) transiently read the previous user's
  // granted consent before the refetch settles — a real leak for the Sentry gate (B-5).
  consent: (profileId: string) => [...gdprKeys.all, 'consent', profileId] as const,
  exportStatus: () => [...gdprKeys.all, 'export'] as const,
  erasure: () => [...gdprKeys.all, 'erasure'] as const,
};

/**
 * All of the caller's consent records (RLS scopes to own).
 *
 * A row of a kind this build does not know is withheld, never thrown on (#841): this feeds Trust,
 * SentryConsentGate and useLocationConsent, and a throw would leave the location gate `unknown`
 * and diagnostics off over one retired `comms` row — the case between a build shipping the
 * narrowed schema and production receiving the purge migration. Each reader looks up a kind it
 * knows, so a row of another kind was never its answer; withholding it changes nothing they read.
 *
 * Only the kind is forgiven. A malformed row of a KNOWN kind still throws: withholding a
 * `location_approx` row with `granted: false` would let useLocationConsent fall back to its ON
 * default and read the position against the member's refusal, and failing closed (`unknown`) is
 * the right failure there. The count is not returned, because the three readers share one
 * persisted cache entry whose shape a wrapper would change under a rehydrating install; the
 * warning carries it (rules/api.md), with no row content.
 */
export async function getConsents(client: AthanorClient): Promise<Consent[]> {
  const { data, error } = await client
    .from('consent')
    .select('id, profile_id, kind, granted, granted_at, source, created_at, updated_at');
  if (error) throw error;
  const rows = data ?? [];
  const known = rows.filter((r) => (CONSENT_KINDS as readonly string[]).includes(r.kind));
  if (known.length < rows.length) {
    console.warn(`[api] consent: ${rows.length - known.length} row(s) of an unknown kind withheld`);
  }
  return known.map((r) => consentSchema.parse(r));
}

/**
 * Upsert one consent record (optimistic toggle). profile_id is set from the session (RLS WITH CHECK
 * pins it to auth.uid()). Unique (profile_id,kind) → upsert on that conflict target, not insert.
 * granted_at is refreshed to "now" on each change so it reflects when this state was set.
 */
export async function setConsent(client: AthanorClient, input: SetConsentInput): Promise<void> {
  const { data: auth } = await client.auth.getUser();
  const profile_id = auth.user?.id;
  if (!profile_id) throw new Error('not authenticated');
  const { error } = await client.from('consent').upsert(
    {
      profile_id,
      kind: input.kind,
      granted: input.granted,
      source: input.source,
      granted_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id,kind' },
  );
  if (error) throw error;
}

/** Convenience for the «Localizzazione approssimativa» toggle (kind=location_approx, source=settings). */
export async function setLocationConsent(client: AthanorClient, granted: boolean): Promise<void> {
  return setConsent(client, { kind: 'location_approx', granted, source: 'settings' });
}

export type { Consent };
