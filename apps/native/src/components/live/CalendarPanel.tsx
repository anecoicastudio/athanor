import { useMemo } from 'react';
import { type Locale, t } from '@athanor/i18n';
import type { Event, EventCalendarFilters } from '@athanor/schemas';
import { FlatList, Pressable, Text, View } from '@/tw';
import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';
import { useCalendarEvents } from '@/hooks/use-calendar-events';
import { HIT_SLOP } from '@/lib/a11y';
import { monthYear } from '@/lib/time';
import { EventRow, toRowData } from './EventRow';
import { PanelError } from './PanelError';

/* ── Calendario ── */
export function CalendarPanel({
  locale,
  onOpen,
  premiumEnabled,
  filters,
  filterCount,
  onOpenFilters,
  onClearFilters,
}: {
  locale: Locale;
  onOpen: (id: string) => void;
  premiumEnabled: boolean;
  /** Resolved filters (#151). Undefined keeps the pre-filter cache entry, shared with Mappa. */
  filters?: EventCalendarFilters;
  /** How many filters the member set — drives the pill's label and its accent. */
  filterCount: number;
  onOpenFilters: () => void;
  onClearFilters: () => void;
}) {
  const query = useCalendarEvents(filters);
  const filtered = filterCount > 0;

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
      ListHeaderComponent={
        // Same pill recipe as the Mappa city chips — active carries the cyan accent, which
        // rule #4 allows for a set filter (an accent, not a moment-grade glow).
        <View className="flex-row px-5 pb-3">
          <Pressable
            onPress={onOpenFilters}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={t('live.filter.a11y', locale)}
            className={`min-h-[44px] justify-center rounded-full border px-4 py-2 ${
              filtered ? 'border-aura-line bg-aura-soft' : 'border-hair bg-raise'
            }`}
          >
            <Text className={`text-[13px] ${filtered ? 'text-aura' : 'text-faint'}`}>
              {filtered
                ? t('live.filter.active', locale, { n: filterCount })
                : t('live.filter.open', locale)}
            </Text>
          </Pressable>
        </View>
      }
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
          <View className="items-center gap-3 px-5 pt-12">
            <EmptyState>
              {t(filtered ? 'live.calendar.emptyFiltered' : 'live.calendar.empty', locale)}
            </EmptyState>
            {filtered ? (
              <Pressable
                onPress={onClearFilters}
                hitSlop={HIT_SLOP}
                accessibilityRole="button"
                className="min-h-[44px] justify-center"
              >
                <Text className="text-[13px] text-aura">
                  {t('live.calendar.clearFilters', locale)}
                </Text>
              </Pressable>
            ) : null}
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
