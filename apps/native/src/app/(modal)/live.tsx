import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  type CalendarCursor,
  type NearbyCursor,
  eventKeys,
  getEventLiveStats,
  getEventsCalendar,
  getEventsNearby,
  getEventsOnline,
  registerAthanorDaysInterest,
  subscribeEventLive,
} from '@athanor/api';
import { semantic } from '@athanor/config';
import { metersToKm } from '@athanor/core';
import { type Locale, t } from '@athanor/i18n';
import type { Event, EventNearby } from '@athanor/schemas';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { ModalHeader } from '@/components/ModalHeader';
import { EventRow, type EventRowData } from '@/components/live/EventRow';
import { PanelTabs, type LivePanel } from '@/components/live/PanelTabs';
import { EmptyState } from '@/components/EmptyState';
import { useAuth } from '@/lib/auth-context';
import { devWarn } from '@/lib/log';
import { useEntitlement } from '@/hooks/use-entitlement';
import { HIT_SLOP } from '@/lib/a11y';
import { supabase } from '@/lib/supabase';

const EVENT_HREF = (id: string) => `/(modal)/event/${id}` as const;

function toRowData(e: Event, premiumEnabled: boolean): EventRowData {
  const live = !!e.live_started_at && !e.live_ended_at;
  const isPremium = e.is_kairos_day || e.is_athanor_day;
  return {
    id: e.id,
    title: e.title,
    category: e.category,
    starts_at: e.starts_at,
    venue: e.venue,
    city: e.city,
    is_online: e.is_online,
    is_kairos_day: e.is_kairos_day,
    is_athanor_day: e.is_athanor_day,
    premiumLocked: isPremium && !premiumEnabled,
    live,
  };
}

function monthKey(iso: string, locale: Locale): string {
  const d = new Date(iso);
  return d.toLocaleDateString(locale === 'it' ? 'it-IT' : 'en-GB', {
    month: 'long',
    year: 'numeric',
  });
}

export default function LiveScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const locale = profile?.locale ?? 'it';
  const [panel, setPanel] = useState<LivePanel>('vicino');
  const { data: entitlement } = useEntitlement();
  const premiumEnabled = entitlement?.features.premiumEvents ?? false;

  return (
    <View className="flex-1 bg-background">
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
        />
      ) : null}
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
    </View>
  );
}

function PanelError({ locale, onRetry }: { locale: Locale; onRetry: () => void }) {
  return (
    <View className="flex-1 items-center justify-center gap-4 px-5">
      <EmptyState>{t('live.error', locale)}</EmptyState>
      <Pressable
        className="rounded-ctl border border-aura-line bg-aura-soft px-5 py-2"
        onPress={onRetry}
      >
        <Text className="text-[13px] text-aura">{t('common.retry', locale)}</Text>
      </Pressable>
    </View>
  );
}

/* ── Vicino a te ── */
function VicinoPanel({ locale, onOpen }: { locale: Locale; onOpen: (id: string) => void }) {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [denied, setDenied] = useState(false);
  const [city, setCity] = useState<string | null>(null);
  const [notified, setNotified] = useState(false);
  const { session } = useAuth();

  const requestLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setDenied(true);
      return;
    }
    setDenied(false);
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
    setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    try {
      const [place] = await Location.reverseGeocodeAsync(pos.coords);
      setCity(place?.city ?? null);
    } catch (e) {
      devWarn('[live] reverseGeocode', e); // city is a label nicety; absence is fine
    }
  };

  useEffect(() => {
    void requestLocation();
  }, []);

  const query = useInfiniteQuery({
    queryKey: eventKeys.nearby(coords?.lat ?? 0, coords?.lng ?? 0, 50),
    queryFn: ({ pageParam }) =>
      getEventsNearby(supabase, coords!.lat, coords!.lng, 50, pageParam as NearbyCursor | null),
    initialPageParam: null as NearbyCursor | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!coords,
  });

  const onNotify = async () => {
    if (!session?.user.id) return;
    try {
      await registerAthanorDaysInterest(supabase, session.user.id, null);
      setNotified(true); // confirm only on a real write — no false success on failure
    } catch (e) {
      devWarn('[live] registerAthanorDaysInterest', e);
    }
  };

  const rows: EventNearby[] = query.data?.pages.flatMap((p) => p.events) ?? [];

  const header = (
    <View className="gap-4 px-5 pb-2">
      <View className="gap-2 rounded-hero border border-aura-line bg-aura-soft p-5">
        <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-aura">
          {t('live.athanorDays.label', locale)}
        </Text>
        <Text className="text-[17px] font-semibold text-foreground">
          {t('live.athanorDays.title', locale)}
        </Text>
        <Text className="text-[14px] text-ink-2">{t('live.athanorDays.body', locale)}</Text>
        <Pressable
          onPress={onNotify}
          className="mt-1 self-start rounded-full border border-aura-line px-4 py-2"
          accessibilityRole="button"
        >
          <Text className="text-[13px] text-aura">
            {notified ? t('live.athanorDays.toast', locale) : t('live.athanorDays.notify', locale)}
          </Text>
        </Pressable>
      </View>
      <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
        {city ? t('live.vicino.section', locale, { city }) : t('live.vicino.sectionNoCity', locale)}
      </Text>
    </View>
  );

  if (denied) {
    return (
      <ScrollView contentContainerClassName="pb-[104px]">
        {header}
        <View className="items-center gap-4 px-5 pt-8">
          <EmptyState>{t('live.map.locationDenied', locale)}</EmptyState>
          <Pressable
            className="rounded-ctl border border-aura-line bg-aura-soft px-5 py-2"
            onPress={() => void requestLocation()}
          >
            <Text className="text-[13px] text-aura">{t('live.map.allowLocation', locale)}</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  if (query.isError) return <PanelError locale={locale} onRetry={() => void query.refetch()} />;

  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      renderItem={({ item }) => (
        <View className="px-5 pb-3">
          <EventRow
            data={{
              id: item.id,
              title: item.title,
              category: item.category,
              starts_at: item.starts_at,
              venue: item.venue,
              city: item.city,
              distanceKm: metersToKm(item.dist_meters),
            }}
            locale={locale}
            onPress={() => onOpen(item.id)}
          />
        </View>
      )}
      ListEmptyComponent={
        coords && !query.isLoading ? (
          <View className="items-center px-5 pt-8">
            <EmptyState>{t('live.vicino.empty', locale)}</EmptyState>
          </View>
        ) : null
      }
      onEndReachedThreshold={0.5}
      onEndReached={() => {
        if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
      }}
      contentContainerClassName="pb-[104px]"
    />
  );
}

/* ── Calendario ── */
function CalendarPanel({
  locale,
  onOpen,
  premiumEnabled,
}: {
  locale: Locale;
  onOpen: (id: string) => void;
  premiumEnabled: boolean;
}) {
  const query = useInfiniteQuery({
    queryKey: eventKeys.calendar(),
    queryFn: ({ pageParam }) => getEventsCalendar(supabase, pageParam as CalendarCursor | null),
    initialPageParam: null as CalendarCursor | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  // group by month (presentation, not business logic) into [{month, items}]
  const sections = useMemo(() => {
    const events = query.data?.pages.flatMap((p) => p.events) ?? [];
    const map = new Map<string, Event[]>();
    for (const e of events) {
      const k = monthKey(e.starts_at, locale);
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
          <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">{month}</Text>
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
      contentContainerClassName="pt-2 pb-[104px]"
    />
  );
}

/* ── Mappa (list-only) ── */
function MapPanel({
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
  const query = useInfiniteQuery({
    queryKey: eventKeys.calendar(),
    queryFn: ({ pageParam }) => getEventsCalendar(supabase, pageParam as CalendarCursor | null),
    initialPageParam: null as CalendarCursor | null,
    getNextPageParam: (last) => last.nextCursor,
  });
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
    <ScrollView contentContainerClassName="pb-[104px]">
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
      <Text className="px-5 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
        {t('live.map.section', locale)}
      </Text>
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

/** A live-now online row that subscribes to its realtime listener count (cleanup on unmount). */
function LiveEventRow({
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

/* ── Online ── */
function OnlinePanel({
  locale,
  onOpen,
  premiumEnabled,
}: {
  locale: Locale;
  onOpen: (id: string) => void;
  premiumEnabled: boolean;
}) {
  const query = useQuery({
    queryKey: eventKeys.online(),
    queryFn: () => getEventsOnline(supabase),
  });
  const all = query.data ?? [];
  const liveNow = all.filter((e) => e.live_started_at && !e.live_ended_at);
  const upcoming = all.filter((e) => !(e.live_started_at && !e.live_ended_at));

  if (query.isError) return <PanelError locale={locale} onRetry={() => void query.refetch()} />;

  return (
    <ScrollView contentContainerClassName="pb-[104px] gap-4">
      <View className="gap-3 px-5">
        <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
          {t('live.online.section', locale)}
        </Text>
        {liveNow.map((e) => (
          <LiveEventRow key={e.id} event={e} locale={locale} onOpen={onOpen} />
        ))}
        {upcoming.map((e) => (
          <EventRow
            key={e.id}
            data={toRowData(e, premiumEnabled)}
            locale={locale}
            onPress={() => onOpen(e.id)}
          />
        ))}
        {all.length === 0 && !query.isLoading ? (
          <EmptyState>{t('live.calendar.empty', locale)}</EmptyState>
        ) : null}
        {query.isLoading ? <ActivityIndicator color={semantic.aura} /> : null}
      </View>
    </ScrollView>
  );
}
