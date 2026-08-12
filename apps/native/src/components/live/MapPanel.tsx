import { useMemo, useState } from 'react';
import { type Locale, t } from '@athanor/i18n';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';
import { useCalendarEvents } from '@/hooks/use-calendar-events';
import { EventRow, toRowData } from './EventRow';
import { PanelError } from './PanelError';

/* ── Mappa (list-only) ── */
export function MapPanel({
  locale,
  onOpen,
  premiumEnabled,
}: {
  locale: Locale;
  onOpen: (id: string) => void;
  premiumEnabled: boolean;
}) {
  const [cityFilter, setCityFilter] = useState<string | null>(null);
  // Reuse the calendar set as the plotted source (events with a city). Real map + the
  // events_map_cities() aggregate are a future dev-client slice (list-only here).
  const query = useCalendarEvents();
  const events = useMemo(
    () => (query.data?.pages.flatMap((p) => p.events) ?? []).filter((e) => !e.is_online && e.city),
    [query.data],
  );

  const cityCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of events) map.set(e.city!, (map.get(e.city!) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);

  const listed = cityFilter ? events.filter((e) => e.city === cityFilter) : events;

  if (query.isError) return <PanelError locale={locale} onRetry={() => void query.refetch()} />;

  return (
    <ScrollView contentContainerClassName="pb-12">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2 px-5 pb-4"
      >
        {cityCounts.map(([c, n]) => {
          const on = c === cityFilter;
          return (
            <Pressable
              key={c}
              onPress={() => setCityFilter(on ? null : c)}
              accessibilityRole="button"
              accessibilityLabel={t('live.map.cityCount', locale, { city: c, n })}
              className={`rounded-full border px-4 py-2 ${on ? 'border-aura-line bg-aura-soft' : 'border-hair bg-raise'}`}
            >
              <Text className={`text-[13px] ${on ? 'text-aura' : 'text-faint'}`}>
                {t('live.map.cityCount', locale, { city: c, n })}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <SectionLabel className="px-5 pb-2">{t('live.map.section', locale)}</SectionLabel>
      <View className="gap-3 px-5">
        {listed.map((e) => (
          <EventRow
            key={e.id}
            data={toRowData(e, premiumEnabled)}
            locale={locale}
            onPress={() => onOpen(e.id)}
          />
        ))}
        {listed.length === 0 && !query.isLoading ? (
          <EmptyState>{t('live.calendar.empty', locale)}</EmptyState>
        ) : null}
      </View>
    </ScrollView>
  );
}
