import type { ReactElement } from 'react';
import { ActivityIndicator, RefreshControl } from 'react-native';
import { semantic } from '@athanor/config';
import { type Locale, t } from '@athanor/i18n';
import { FlatList, View } from '@/tw';
import { ListState } from '@/components/ListState';
import { EventRow, toRowData } from '@/components/live/EventRow';
import { useCalendarEvents } from '@/hooks/use-calendar-events';
import { useEntitlement } from '@/hooks/use-entitlement';
import { listState } from '@/lib/list-state';

/**
 * The feed's «Eventi» tab (#153): real `events` rows as feed cards, tap → event detail.
 *
 * Reads the shared calendar query with no filters — the same cache entry Live's Calendario and
 * Mappa hold, so opening the tab warms Live rather than duplicating it. `starts_at` ascending,
 * which is `getEventsCalendar`'s ordering: soonest first, deliberately the opposite direction
 * from the posts feed's `created_at desc`, because "what is happening and what is coming" is
 * the question this tab answers. Since #530 that includes events already under way, which sort
 * ahead of the upcoming ones and carry the «In diretta» chip.
 *
 * A separate component and not a branch inside the screen so the hook only runs while the tab
 * is mounted: the posts tabs never fetch the calendar, and the list stays homogeneous —
 * `FlatList` is generic on its item, and one list over `Post | EventRowData` would infer
 * neither.
 */
export function EventsFeedList({
  locale,
  header,
  onOpen,
  onCreate,
}: {
  locale: Locale;
  /** The screen's own header (title, composer, tabs, Live card, rail) — shared with the posts list. */
  header: ReactElement;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const { data: entitlement } = useEntitlement();
  const premiumEnabled = entitlement?.features.premiumEvents ?? false;

  const query = useCalendarEvents();
  const rows = (query.data?.pages.flatMap((p) => p.events) ?? []).map((e) =>
    toRowData(e, premiumEnabled),
  );

  const onRefresh = () => void query.refetch();
  // staleWins: true — rows the member is reading are worth more than blanking them on a failed
  // refetch, and this list is always one pull away from a retry (list-state.ts).
  const state = listState({
    status: query.status,
    fetchStatus: query.fetchStatus,
    isEmpty: rows.length === 0,
    staleWins: true,
  });

  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      renderItem={({ item }) => (
        <View className="px-5 pb-4">
          <EventRow data={item} locale={locale} onPress={() => onOpen(item.id)} />
        </View>
      )}
      ListEmptyComponent={
        <ListState
          state={state}
          locale={locale}
          errorLabel={t('feed.error', locale)}
          emptyLabel={t('feed.empty.eventi.title', locale)}
          emptyAction={{ label: t('feed.empty.eventi.cta', locale), onPress: onCreate }}
          onRetry={onRefresh}
          className="px-8 pt-16"
          loading={
            <View className="items-center pt-16">
              <ActivityIndicator color={semantic.aura} />
            </View>
          }
        />
      }
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching}
          onRefresh={onRefresh}
          tintColor={semantic.aura}
        />
      }
      onEndReachedThreshold={0.5}
      onEndReached={() => {
        if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
      }}
      contentContainerClassName="pb-12"
    />
  );
}
