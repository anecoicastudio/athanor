import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { eventKeys, getEventLiveStats, subscribeEventLive } from '@athanor/api';
import type { Locale } from '@athanor/i18n';
import type { Event } from '@athanor/schemas';
import { supabase } from '@/lib/supabase';
import { EventRow, toRowData } from './EventRow';

/** A live-now online row that subscribes to its realtime listener count (cleanup on unmount). */
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
  const [isLive, setIsLive] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeEventLive(supabase, event.id, (stats) => {
      setCount(stats.listener_count);
      setIsLive(stats.is_live);
    });
    return unsubscribe; // cleanup on unmount (rule api.md)
  }, [event.id]);

  const listeningCount = count ?? seed.data?.listener_count ?? null;

  return (
    <EventRow
      data={{ ...toRowData(event, true), live: isLive, listeningCount }}
      locale={locale}
      onPress={() => onOpen(event.id)}
    />
  );
}
