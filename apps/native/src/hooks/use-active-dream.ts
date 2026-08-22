import { dreamKeys, getActiveDream } from '@athanor/api';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * A member's single active dream (PRD §4.3 — one per profile). Null when none is planted yet,
 * which is a real answer and not an error: the caller must not turn it into «non disponibile».
 *
 * Person Detail and the offer-help picker both read it for the same person, so the second of
 * the two to open finds it cached.
 */
export function activeDreamQuery(profileId: string | null | undefined) {
  return queryOptions({
    queryKey: dreamKeys.byProfile(profileId ?? ''),
    queryFn: () => getActiveDream(supabase, profileId as string),
    enabled: Boolean(profileId),
  });
}

export function useActiveDream(profileId: string | null | undefined) {
  return useQuery(activeDreamQuery(profileId));
}
