import { useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { t } from '@athanor/i18n';
import { Pressable, Text, View } from '@/tw';
import { ModalHeader } from '@/components/ModalHeader';
import { CalendarPanel } from '@/components/live/CalendarPanel';
import { EVENT_HREF } from '@/components/live/EventRow';
import { MapPanel } from '@/components/live/MapPanel';
import { OnlinePanel } from '@/components/live/OnlinePanel';
import { PanelTabs, type LivePanel } from '@/components/live/PanelTabs';
import { VicinoPanel } from '@/components/live/VicinoPanel';
import { useEntitlement } from '@/hooks/use-entitlement';
import { useLocale } from '@/hooks/use-locale';
import { HIT_SLOP } from '@/lib/a11y';
import {
  EMPTY_EVENT_FILTER_PARAMS,
  activeFilterCount,
  parseEventFilters,
  type EventFilterParams,
} from '@/lib/event-filters';
import { Screen } from '@/components/Screen';

export default function LiveScreen() {
  const router = useRouter();
  const locale = useLocale();
  // Discovery filters (#151) round-trip through the route, the way search-filters.tsx does:
  // the sheet dismissTo's back here with them as params and this screen re-derives the query
  // filters from them. Held in the URL rather than in state so a deep link can carry them.
  const params = useLocalSearchParams<EventFilterParams>();
  const filterCount = activeFilterCount(params);
  // Destructured rather than memoised on `params` itself: `useLocalSearchParams` hands back a
  // fresh object every render, so the object as a dep would re-resolve the window on each one.
  const { category, city, date } = params;
  // Re-resolved whenever the params change rather than stored as instants, so applying
  // «oggi» a second time always means today.
  const filters = useMemo(
    () => parseEventFilters({ category, city, date }),
    [category, city, date],
  );
  const [panel, setPanel] = useState<LivePanel>(() =>
    activeFilterCount(params) > 0 ? 'calendario' : 'vicino',
  );
  const { data: entitlement } = useEntitlement();
  const premiumEnabled = entitlement?.features.premiumEvents ?? false;

  return (
    <Screen>
      <ModalHeader
        title={t('live.title', locale)}
        backLabel={t('common.back', locale)}
        right={
          <Pressable
            onPress={() => router.push('/(modal)/my-events')}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={t('live.mine.title', locale)}
          >
            <Text className="text-[13px] text-aura">{t('live.mine.title', locale)}</Text>
          </Pressable>
        }
      />
      <View className="pb-3">
        <PanelTabs active={panel} onChange={setPanel} locale={locale} />
      </View>
      {panel === 'vicino' ? (
        <VicinoPanel locale={locale} onOpen={(id) => router.push(EVENT_HREF(id))} />
      ) : null}
      {panel === 'calendario' ? (
        <CalendarPanel
          locale={locale}
          onOpen={(id) => router.push(EVENT_HREF(id))}
          premiumEnabled={premiumEnabled}
          filters={filters}
          filterCount={filterCount}
          onOpenFilters={() => router.push({ pathname: '/(modal)/event-filters', params })}
          onClearFilters={() => router.setParams(EMPTY_EVENT_FILTER_PARAMS)}
        />
      ) : null}
      {/* Mappa stays deliberately UNFILTERED (#151). Its city chips are a client-side facet
          computed from the loaded page set, so a server-side city filter would collapse the
          chip row to the one city already chosen. Sharing the filter state needs the
          events_map_cities() aggregate, which is the map half of #151 and out of this slice. */}
      {panel === 'mappa' ? (
        <MapPanel
          locale={locale}
          onOpen={(id) => router.push(EVENT_HREF(id))}
          premiumEnabled={premiumEnabled}
        />
      ) : null}
      {panel === 'online' ? (
        <OnlinePanel
          locale={locale}
          onOpen={(id) => router.push(EVENT_HREF(id))}
          premiumEnabled={premiumEnabled}
        />
      ) : null}
    </Screen>
  );
}
