import { helpKeys, listMyHelpsForMilestones } from '@athanor/api';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * My prior offers on ONE dream's tappe. Scoped to the tappe rather than read as a page of my
 * newest offers, because an older offer on this dream would fall off that page and render an
 * already-helped tappa as un-helped — a dead-end «Aiuta», since the (milestone_id, helper_id)
 * unique index answers a re-offer with a 23505.
 *
 * The dream id joins the `mine` prefix so two dreams cannot share one entry, while
 * `helpKeys.mine(helperId)` still invalidates every dream at once — which is what lets the
 * offer sheet refresh Person Detail behind it, with no focus-refetch on either screen.
 *
 * `milestoneIds` stays OUT of the key on purpose: it is derived from the dream, so folding it in
 * would only split the entry each time the tappe list is refetched.
 */
export function myHelpsForDreamQuery(
  helperId: string | null | undefined,
  dreamId: string | null | undefined,
  milestoneIds: string[],
) {
  return queryOptions({
    queryKey: [...helpKeys.mine(helperId ?? ''), dreamId ?? ''] as const,
    queryFn: () => listMyHelpsForMilestones(supabase, helperId as string, milestoneIds),
    enabled: Boolean(helperId) && Boolean(dreamId) && milestoneIds.length > 0,
  });
}

export function useMyHelpsForDream(
  helperId: string | null | undefined,
  dreamId: string | null | undefined,
  milestoneIds: string[],
) {
  return useQuery(myHelpsForDreamQuery(helperId, dreamId, milestoneIds));
}
