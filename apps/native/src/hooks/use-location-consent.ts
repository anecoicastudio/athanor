import { useQuery } from '@tanstack/react-query';
import { gdprKeys, getConsents } from '@athanor/api';
import { useAuth } from '@/lib/auth-context';
import { type LocationConsent, locationConsentOf } from '@/lib/location-consent';
import { supabase } from '@/lib/supabase';

/**
 * The member's «Localizzazione approssimativa» switch (#783), read from the same profile-scoped
 * consent query Trust and SentryConsentGate use — one cache entry, so flipping the switch reaches
 * every reader on the same invalidation. `unknown` until THIS member's records load (an account
 * switch changes the key), and every device-position read waits for `on`.
 */
export function useLocationConsent(): LocationConsent {
  const { session, profile } = useAuth();
  const profileId = profile?.id;
  const consents = useQuery({
    queryKey: gdprKeys.consent(profileId ?? ''),
    queryFn: () => getConsents(supabase),
    enabled: !!session && !!profileId,
  });
  return consents.isSuccess && profileId ? locationConsentOf(consents.data) : 'unknown';
}
