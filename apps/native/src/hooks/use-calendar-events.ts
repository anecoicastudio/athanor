import { useInfiniteQuery } from '@tanstack/react-query';
import { type CalendarCursor, eventKeys, getEventsCalendar } from '@athanor/api';
import type { EventCalendarFilters } from '@athanor/schemas';
import { supabase } from '@/lib/supabase';

/**
 * Shared infinite query over the events calendar (cursor pagination, rule #9).
 *
 * Called with no filters — Mappa, and Calendario before the member opens the sheet — it
 * keeps the single cache entry the two panels have always shared. A filter set makes it a
 * DIFFERENT entry (`eventKeys.calendar(filters)`), which is what guarantees rule #9's
 * "a changed filter set starts a fresh cursor": TanStack seeds a new entry at
 * `initialPageParam: null`, so a cursor minted under the old filters cannot be continued
 * under the new ones.
 */
export function useCalendarEvents(filters?: EventCalendarFilters) {
  return useInfiniteQuery({
    queryKey: eventKeys.calendar(filters),
    queryFn: ({ pageParam }) =>
      getEventsCalendar(supabase, pageParam as CalendarCursor | null, undefined, filters),
    initialPageParam: null as CalendarCursor | null,
    getNextPageParam: (last) => last.nextCursor,
    // A FILTERED entry is deliberately kept out of the persisted cache (the opt-out
    // `query-client.ts` documents). Every filter combination is its own entry, and the date
    // presets roll at local midnight, so persisting them would multiply pages of full event
    // rows into one AsyncStorage blob for no gain — a filter is a momentary question, not
    // state worth surviving an app kill. The unfiltered entry persists exactly as before.
    meta: filters ? { persist: false } : undefined,
  });
}
