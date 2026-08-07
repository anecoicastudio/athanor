import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { gdprKeys, getConsents } from '@athanor/api';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { closeSentry, initSentry, setTelemetryConsent } from '@/lib/sentry';

/**
 * Bridges the user's `analytics` (diagnostics) consent to Sentry (P1.4 / B-5). Sentry is
 * initialized only once consent is granted and torn down when it is revoked / on logout —
 * so no telemetry (incl. session + native crash envelopes) leaves the device before consent.
 *
 * The consent query is profile-scoped, and `granted` requires `isSuccess`, so on an account
 * switch the previous user's persisted consent can't transiently re-enable telemetry: the key
 * changes → the query is pending → `granted` is false until THIS user's record loads.
 * Renders nothing.
 */
export function SentryConsentGate() {
  const { session, profile } = useAuth();
  const profileId = profile?.id;

  const consents = useQuery({
    queryKey: gdprKeys.consent(profileId ?? ''),
    queryFn: () => getConsents(supabase),
    enabled: !!session && !!profileId,
  });

  const granted =
    consents.isSuccess &&
    !!profileId &&
    (consents.data.find((c) => c.kind === 'analytics')?.granted ?? false);

  useEffect(() => {
    if (granted) {
      setTelemetryConsent(true);
      initSentry();
    } else {
      setTelemetryConsent(false);
      closeSentry();
    }
  }, [granted]);

  return null;
}
