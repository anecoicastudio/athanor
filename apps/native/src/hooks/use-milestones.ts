import { listMilestones, milestoneKeys } from '@athanor/api';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * A dream's tappe, oldest-first by the (position, created_at, id) keyset (rule #9).
 * Keyed by dream rather than by member, so Person Detail and the offer-help picker share the
 * entry for the dream they are both looking at.
 */
export function milestonesQuery(dreamId: string | null | undefined) {
  return queryOptions({
    queryKey: milestoneKeys.list(dreamId ?? ''),
    queryFn: () => listMilestones(supabase, dreamId as string),
    enabled: Boolean(dreamId),
  });
}

export function useMilestones(dreamId: string | null | undefined) {
  return useQuery(milestonesQuery(dreamId));
}
