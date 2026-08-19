import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { gdprKeys, getConsents } from '@athanor/api';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { endedCleanly, readPreviousTrail } from '@/lib/crash-trail';
import { captureTrail, closeSentry, initSentry, setTelemetryConsent } from '@/lib/sentry';

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

  // The previous run's trail goes up at most once per launch, even if consent is toggled twice.
  const trailSent = useRef(false);

  useEffect(() => {
    if (granted) {
      setTelemetryConsent(true);
      initSentry();
      // A native process death raises no JS exception, so this is the only report Sentry will ever
      // get about it (#452). Sent from here rather than from CrashTrailGate because it has to
      // follow init: captureTrail no-ops before it, and beforeSend/beforeBreadcrumb would drop
      // everything pre-consent anyway.
      if (!trailSent.current) {
        trailSent.current = true;
        void readPreviousTrail().then((previous) => {
          if (previous && !endedCleanly(previous)) captureTrail(previous.steps);
        });
      }
    } else {
      setTelemetryConsent(false);
      closeSentry();
    }
  }, [granted]);

  return null;
}
