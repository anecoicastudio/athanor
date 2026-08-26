import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
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
import { FlatList, Pressable, ScrollView, Text, View } from '@/tw';
import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';
import { useToast } from '@/components/ToastHost';
import { useAuth } from '@/lib/auth-context';
import { devWarn } from '@/lib/log';
import { toStatus } from '@/lib/media/permission-status';
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
  /**
   * Why there is no list (#549). `denied` re-prompts on the next ask, so its action retries;
   * `blocked` never will — the OS resolves instantly with no dialog, which made the old retry
   * action a permanent no-op — so its action deep-links to Settings instead. The #179 error
   * path (services off, timed-out fix) deliberately lands on `denied`: retry is its way back.
   */
  const [refusal, setRefusal] = useState<'denied' | 'blocked' | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [notified, setNotified] = useState(false);
  const { showToast } = useToast();
  const { session } = useAuth();

  // Never rejects: both callers fire it as `void requestLocation()` (mount + the retry button).
  const requestLocation = async () => {
    let pos: Location.LocationObject;
    try {
      const res = await Location.requestForegroundPermissionsAsync();
      if (!res.granted) {
        // Same mapper as calendar.ts (#531): `canAskAgain` is the whole denied/blocked
        // difference, and not reading it is what made blocked a dead end here (#549).
        setRefusal(toStatus(res) === 'blocked' ? 'blocked' : 'denied');
        return;
      }
      setRefusal(null);
      pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
    } catch (e) {
      // Location services off, a fix that timed out, a prompt that never resolved — until #179
      // this rejection went unhandled and the panel sat blank with no way back. Say so, and
      // reuse the denied state: its «Consenti la posizione» action is the retry.
      devWarn('[live] requestLocation', e);
      setRefusal('denied');
      showToast(t('live.map.locationError', locale));
      return;
    }
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
      // #132: this write is the only demand signal Athanor Days collects — a swallowed
      // failure both lies to the member and loses the datum. Surface it; `notified`
      // stays false, so the CTA still reads «Avvisami» and a second tap retries.
      devWarn('[live] registerAthanorDaysInterest', e);
      showToast(t('live.athanorDays.error', locale));
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

  if (refusal) {
    const blocked = refusal === 'blocked';
    return (
      <View className="flex-1">
        <ScrollView contentContainerClassName="pb-12">
          {header}
          <View className="items-center px-5 pt-8">
            {/* Ghost action per DESIGN §9 — the framed cyan pill this replaced spent the
                moment-grade surface (rule #4) on a permission ask (#119).
                Blocked keeps the subject line (it names the permission, which the shared body
                does not) and adds `permission.blocked.body` + the Settings route — the shared
                blocked copy per the candidacy precedent; the calendar's bespoke key is the
                recorded exception (#552), not this. Literal keys on every arm. */}
            <EmptyState
              body={blocked ? t('permission.blocked.body', locale) : undefined}
              action={
                blocked
                  ? {
                      label: t('permission.openSettings', locale),
                      onPress: () => void Linking.openSettings(),
                    }
                  : {
                      label: t('live.map.allowLocation', locale),
                      onPress: () => void requestLocation(),
                    }
              }
            >
              {t('live.map.locationDenied', locale)}
            </EmptyState>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (query.isError) return <PanelError locale={locale} onRetry={() => void query.refetch()} />;

  return (
    <View className="flex-1">
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
        contentContainerClassName="pb-12"
      />
    </View>
  );
}
