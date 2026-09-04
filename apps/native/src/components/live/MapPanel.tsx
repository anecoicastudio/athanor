import { useMemo, useState } from 'react';
import { type Locale, t } from '@athanor/i18n';
import { ScrollView, View } from '@/tw';
import { Chip } from '@/components/Chip';
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
        {/* `Chip small` (#635). Role and label were already right; `selected` was missing, so
            the filtered city was cyan and nothing else — and the pill missed 44pt. `Chip` takes
            the same string for its label and its text, which is what these two lines were. */}
        {cityCounts.map(([c, n]) => (
          <Chip
            key={c}
            small
            label={t('live.map.cityCount', locale, { city: c, n })}
            selected={c === cityFilter}
            onPress={() => setCityFilter(c === cityFilter ? null : c)}
          />
        ))}
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
