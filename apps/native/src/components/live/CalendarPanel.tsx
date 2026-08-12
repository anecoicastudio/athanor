import { useMemo } from 'react';
import { type Locale, t } from '@athanor/i18n';
import type { Event } from '@athanor/schemas';
import { FlatList, View } from '@/tw';
import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';
import { useCalendarEvents } from '@/hooks/use-calendar-events';
import { monthYear } from '@/lib/time';
import { EventRow, toRowData } from './EventRow';
import { PanelError } from './PanelError';

/* ── Calendario ── */
export function CalendarPanel({
  locale,
  onOpen,
  premiumEnabled,
}: {
  locale: Locale;
  onOpen: (id: string) => void;
  premiumEnabled: boolean;
}) {
  const query = useCalendarEvents();

  // group by month (presentation, not business logic) into [{month, items}]
  const sections = useMemo(() => {
    const events = query.data?.pages.flatMap((p) => p.events) ?? [];
    const map = new Map<string, Event[]>();
    for (const e of events) {
      const k = monthYear(e.starts_at, locale);
      const arr = map.get(k) ?? [];
      arr.push(e);
      map.set(k, arr);
    }
    return [...map.entries()];
  }, [query.data, locale]);

  if (query.isError) return <PanelError locale={locale} onRetry={() => void query.refetch()} />;

  return (
    <FlatList
      data={sections}
      keyExtractor={([month]) => month}
      renderItem={({ item: [month, items] }) => (
        <View className="gap-3 px-5 pb-4">
          <SectionLabel>{month}</SectionLabel>
          {items.map((e) => (
            <EventRow
              key={e.id}
              data={toRowData(e, premiumEnabled)}
              locale={locale}
              onPress={() => onOpen(e.id)}
            />
          ))}
        </View>
      )}
      ListEmptyComponent={
        query.isLoading ? null : (
          <View className="items-center px-5 pt-12">
            <EmptyState>{t('live.calendar.empty', locale)}</EmptyState>
          </View>
        )
      }
      onEndReachedThreshold={0.5}
      onEndReached={() => {
        if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
      }}
      contentContainerClassName="pt-2 pb-12"
    />
  );
}
