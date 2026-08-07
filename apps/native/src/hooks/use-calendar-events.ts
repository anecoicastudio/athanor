import { useInfiniteQuery } from '@tanstack/react-query';
import { type CalendarCursor, eventKeys, getEventsCalendar } from '@athanor/api';
import { supabase } from '@/lib/supabase';

/**
 * Shared infinite query over the events calendar (cursor pagination, rule #9).
 * One query key — Calendario and Mappa panels both read this same cache entry.
 */
export function useCalendarEvents() {
  return useInfiniteQuery({
    queryKey: eventKeys.calendar(),
    queryFn: ({ pageParam }) => getEventsCalendar(supabase, pageParam as CalendarCursor | null),
    initialPageParam: null as CalendarCursor | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}
