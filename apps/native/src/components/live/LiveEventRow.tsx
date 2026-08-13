import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  eventKeys,
  getEventLiveStats,
  subscribeEventLive,
  subscribeEventPresence,
} from '@athanor/api';
import type { Locale } from '@athanor/i18n';
import type { Event } from '@athanor/schemas';
import { supabase } from '@/lib/supabase';
import { EventRow, toRowData } from './EventRow';

/**
 * A live-now online row. The live flag streams from event_live_stats (cron-maintained);
 * the listening count is the presence room's size, observed WITHOUT tracking — browsing
 * the Live tab is not listening; only the event-detail screen tracks (#120).
 * Both subscriptions clean up on unmount (rule api.md).
 */
export function LiveEventRow({
  event,
  locale,
  onOpen,
}: {
  event: Event;
  locale: Locale;
  onOpen: (id: string) => void;
}) {
  const seed = useQuery({
    queryKey: eventKeys.liveStats(event.id),
    queryFn: () => getEventLiveStats(supabase, event.id),
  });
  const [count, setCount] = useState<number | null>(null);
  const [isLive, setIsLive] = useState<boolean | null>(null);

  useEffect(() => {
    const unsubscribeLive = subscribeEventLive(supabase, event.id, (stats) => {
      setIsLive(stats.is_live);
    });
    const unsubscribePresence = subscribeEventPresence(supabase, event.id, setCount);
    return () => {
      unsubscribeLive();
      unsubscribePresence();
    };
  }, [event.id]);

  const live = isLive ?? seed.data?.is_live ?? true;

  return (
    <EventRow
      data={{ ...toRowData(event, true), live, listeningCount: count }}
      locale={locale}
      onPress={() => onOpen(event.id)}
    />
  );
}
