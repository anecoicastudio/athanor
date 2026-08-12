import { useInfiniteQuery } from '@tanstack/react-query';
import { type NeedCursor, favorKeys, listOpenNeeds } from '@athanor/api';
import { supabase } from '@/lib/supabase';

/**
 * The ONE query behind `favorKeys.openNeeds` — the Passa il Favore sheet and Home's
 * `FavorNudgeCard` both read this cache entry (keyset cursor, never offset — rule #9).
 *
 * A hook rather than a comment because the hazard here is silent. #99 proposed giving Home a
 * plain `useQuery(listOpenNeeds(supabase, null, 2))` on this same key; the sheet holds it with
 * `useInfiniteQuery`, whose cached value is `{pages, pageParams}` and not a `NeedsPage`. Two
 * shapes under one key type-check independently and corrupt whichever consumer reads second —
 * the failure `lib/week-recap.ts:7-9` describes for `auraKeys.recap`, which is guarded by
 * convention there and by construction here.
 *
 * Sharing the entry also buys the coupling for free: the sheet's
 * `invalidateQueries(favorKeys.openNeeds)` after a favor is passed refreshes Home with no wiring.
 *
 * The `favor_needs` view is already viewer-personalised — it excludes your own needs and anything
 * you have already favored (`20260615081559_favor_offers.sql:89-114`) — so a non-empty first page
 * IS "there is something you could do", with no client-side filtering.
 */
export function useOpenNeeds() {
  return useInfiniteQuery({
    queryKey: favorKeys.openNeeds,
    queryFn: ({ pageParam }) => listOpenNeeds(supabase, pageParam as NeedCursor | null),
    initialPageParam: null as NeedCursor | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}
