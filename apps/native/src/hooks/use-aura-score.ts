import { queryOptions, useQuery } from '@tanstack/react-query';
import { auraKeys, getAuraScore } from '@athanor/api';
import { supabase } from '@/lib/supabase';

/**
 * A member's read-only Aura snapshot (rule #1 — never client-written; the score-engine fills it).
 * Home, Impostazioni, the chat header and both profile surfaces all read this one cache entry,
 * and `(tabs)/profile.tsx` invalidates `auraKeys.score(uid)` after a celebration — which only
 * reaches them because the key is spelled once, here.
 *
 * Pass null/undefined to no-op (the query stays disabled): the viewed member's id is not known
 * on the first render of a deep link, and a `''` key would cache a request nobody made.
 */
export function auraScoreQuery(profileId: string | null | undefined) {
  return queryOptions({
    queryKey: auraKeys.score(profileId ?? ''),
    queryFn: () => getAuraScore(supabase, profileId as string),
    enabled: Boolean(profileId),
  });
}

export function useAuraScore(profileId: string | null | undefined) {
  return useQuery(auraScoreQuery(profileId));
}
