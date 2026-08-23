import { useState } from 'react';
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
  // Resolved on every render, deliberately NOT memoised: memoising on the params would freeze
  // the window at whenever they last changed, so a screen still mounted after midnight would
  // keep querying yesterday's «oggi» — the exact failure the preset round-trip exists to avoid.
  // Re-resolving is cheap and stable: within a day it returns the same local-midnight bounds,
  // and TanStack hashes the query key structurally, so an equal window never refetches.
  const filters = parseEventFilters(params);
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
