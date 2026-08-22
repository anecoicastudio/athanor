import { queryOptions, useQuery } from '@tanstack/react-query';
import { getStars, starKeys } from '@athanor/api';
import { supabase } from '@/lib/supabase';

/**
 * A member's stars. Earned-only through RLS on someone else's profile (rule #3), so the same
 * query serves the own Six Stars grid, the star detail sheet, the weekly recap and Person Detail.
 *
 * Deliberately NOT merged with `useAuraScore` even though every screen reads both: they must be
 * able to fail apart. One combined query let a live score render beside six stars claiming
 * nothing was earned (issue #16). Callers coalesce with `starsOrNull`, never `?? []`.
 */
export function starsQuery(profileId: string | null | undefined) {
  return queryOptions({
    queryKey: starKeys.list(profileId ?? ''),
    queryFn: () => getStars(supabase, profileId as string),
    enabled: Boolean(profileId),
  });
}

export function useStars(profileId: string | null | undefined) {
  return useQuery(starsQuery(profileId));
}
