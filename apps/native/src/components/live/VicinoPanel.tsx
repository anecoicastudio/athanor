import { useEffect, useState } from 'react';
import { FlatList } from 'react-native';
import * as Location from 'expo-location';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  type NearbyCursor,
  eventKeys,
  getEventsNearby,
  registerAthanorDaysInterest,
} from '@athanor/api';
import { metersToKm } from '@athanor/core';
import { type Locale, t } from '@athanor/i18n';
import type { EventNearby } from '@athanor/schemas';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';
import { useAuth } from '@/lib/auth-context';
import { devWarn } from '@/lib/log';
import { supabase } from '@/lib/supabase';
import { EventRow } from './EventRow';
import { PanelError } from './PanelError';

/** Athanor-Days promo card — glow-framed (aura-soft) header above the nearby list. */
function AthanorDaysCard({
  locale,
  notified,
  onNotify,
}: {
  locale: Locale;
  notified: boolean;
  onNotify: () => void;
}) {
  return (
    <View className="gap-2 rounded-hero border border-aura-line bg-aura-soft p-5">
      <SectionLabel tone="aura">{t('live.athanorDays.label', locale)}</SectionLabel>
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
  );
}

/* ── Vicino a te ── */
export function VicinoPanel({ locale, onOpen }: { locale: Locale; onOpen: (id: string) => void }) {
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
      <AthanorDaysCard locale={locale} notified={notified} onNotify={() => void onNotify()} />
      <SectionLabel>
        {city ? t('live.vicino.section', locale, { city }) : t('live.vicino.sectionNoCity', locale)}
      </SectionLabel>
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
