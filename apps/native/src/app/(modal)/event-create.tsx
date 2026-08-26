import { useState } from 'react';
import { Linking, Platform } from 'react-native';
import { KeyboardAvoiding } from '@/components/KeyboardAvoiding';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createEvent, eventKeys } from '@athanor/api';
import { type MessageKey, t } from '@athanor/i18n';
import { parseEuroToCents } from '@athanor/core';
import { type EventCategory, eventCreateSchema } from '@athanor/schemas';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { EVENT_HREF } from '@/components/live/EventRow';
import { Input } from '@/components/Input';
import { ModalHeader } from '@/components/ModalHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { useToast } from '@/components/ToastHost';
import { useLocale } from '@/hooks/use-locale';
import { devWarn } from '@/lib/log';
import { toStatus } from '@/lib/media/permission-status';
import { supabase } from '@/lib/supabase';
import { dateTimeWithYear } from '@/lib/time';
import { Screen } from '@/components/Screen';

const CATEGORIES: EventCategory[] = [
  'networking',
  'business',
  'creativi',
  'musica',
  'benessere',
  'formazione',
  'spiritualita',
  'arte',
  'evoluzione',
];

export default function EventCreateScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const locale = useLocale();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<EventCategory>('networking');
  const [isOnline, setIsOnline] = useState(false);
  const [venue, setVenue] = useState('');
  const [city, setCity] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [streamUrl, setStreamUrl] = useState('');
  const [startsAt, setStartsAt] = useState<Date>(() => new Date(Date.now() + 7 * 86400000));
  const [showPicker, setShowPicker] = useState(false);
  const [capacity, setCapacity] = useState('');
  const [paid, setPaid] = useState(false);
  const [price, setPrice] = useState('');
  // #437 — the settlement acknowledgement. UNTICKED, always, and never remembered: CRD 2011/83/EU
  // Art. 22 excludes pre-ticked boxes, and a remembered tick is a pre-ticked box wearing a
  // different name (the same reasoning as fund-disclosure.tsx's coverage box). Per event, because
  // the 14-day promise attaches to an event rather than to the organiser.
  const [settlementAck, setSettlementAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Why «Usa la mia posizione» did nothing (#549). Outcome stored, sentence derived at render
   * (the [id] screen's #531 reasoning: no timer, must survive a locale flip). `denied` keeps
   * the pill as the retry — the OS will ask again; `blocked` never re-prompts, so the notice
   * grows the Settings route instead.
   */
  const [locationRefusal, setLocationRefusal] = useState<'denied' | 'blocked' | null>(null);
  const { showToast } = useToast();

  const requestMyLocation = async () => {
    setLocationRefusal(null);
    let pos: Location.LocationObject;
    try {
      const res = await Location.requestForegroundPermissionsAsync();
      if (!res.granted) {
        // Was `if (status !== 'granted') return;` — silent, and iOS prompts once per app, so
        // every tap after the first resolved denied with no dialog: a pill that did nothing,
        // forever, while onSubmit kept demanding the position it could never get (#549).
        setLocationRefusal(toStatus(res) === 'blocked' ? 'blocked' : 'denied');
        return;
      }
      pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
    } catch (e) {
      // Services off / a fix that timed out: this rejection escaped `void requestMyLocation()`
      // unhandled — the second silent path. Same recovery as VicinoPanel's #179: say so with a
      // toast; the pill itself is the retry.
      devWarn('[event-create] requestMyLocation', e);
      showToast(t('live.map.locationError', locale));
      return;
    }
    setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    try {
      const [place] = await Location.reverseGeocodeAsync(pos.coords);
      if (place?.city && !city) setCity(place.city);
    } catch (e) {
      devWarn('[event-create] reverseGeocode', e);
      // label nicety only
    }
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = eventCreateSchema.parse({
        title,
        category,
        is_online: isOnline,
        venue: isOnline ? null : venue || null,
        // Trimmed: the calendar filter matches `city` whole, so a stored «Milano » would
        // never match a member filtering for «Milano» (#151).
        city: isOnline ? null : city.trim() || null,
        lat: isOnline ? null : (coords?.lat ?? null),
        long: isOnline ? null : (coords?.lng ?? null),
        stream_url: isOnline ? streamUrl || null : null,
        starts_at: startsAt.toISOString(),
        ends_at: null,
        capacity: capacity ? Number(capacity) : null,
        // Floor 0, named: a ticket may be free (`events.price_cents >= 0`), unlike a fund
        // contribution, whose €1 minimum is the parser's default (#387).
        price_cents: paid && price ? parseEuroToCents(price, 0) : 0,
        currency: 'eur',
        // The boolean is all the client gets to say. `settlement_ack_at` is stamped by
        // create_event from now() — a client-supplied timestamp would be evidence of nothing.
        settlement_ack: paid && settlementAck,
      });
      return createEvent(supabase, parsed);
    },
    onSuccess: async (event) => {
      await queryClient.invalidateQueries({ queryKey: eventKeys.all });
      router.replace(EVENT_HREF(event.id));
    },
    onError: () => setError(t('event.create.error', locale)),
  });

  const onSubmit = () => {
    setError(null);
    // Paid events require verified identity (PRD §4.13) — gated to M9; block here.
    if (paid) {
      setError(t('event.create.verifyGate', locale));
      return;
    }
    // Unreachable while the gate above returns for every paid event, and deliberately written
    // anyway: it is correct the moment #416/M9 lifts that gate, and it is not what makes the
    // disclosure real in the meantime — create_event refuses a paid event with no acknowledgement
    // regardless of what this file says (#437).
    if (paid && !settlementAck) {
      setError(t('event.create.settlement.required', locale));
      return;
    }
    if (title.trim().length === 0) return setError(t('event.create.error', locale));
    if (!isOnline && !coords) return setError(t('event.create.locationNeeded', locale));
    mutation.mutate();
  };

  const label = (key: MessageKey) => <SectionLabel>{t(key, locale)}</SectionLabel>;

  return (
    <KeyboardAvoiding>
      <Screen>
        <ModalHeader title={t('event.create.title', locale)} backLabel={t('common.back', locale)} />
        <ScrollView className="flex-1" contentContainerClassName="gap-5 px-5 pb-16">
          <View className="gap-2">
            {label('event.create.name')}
            <Input
              placeholder={t('event.create.namePlaceholder', locale)}
              value={title}
              onChangeText={setTitle}
              maxLength={140}
            />
          </View>

          <View className="gap-2">
            {label('event.create.category')}
            <View className="flex-row flex-wrap gap-2">
              {CATEGORIES.map((c) => {
                const on = c === category;
                return (
                  <Pressable
                    key={c}
                    onPress={() => setCategory(c)}
                    className={`rounded-full border px-4 py-2 ${on ? 'border-aura-line bg-aura-soft' : 'border-hair bg-raise'}`}
                  >
                    <Text className={`text-[13px] ${on ? 'text-aura' : 'text-faint'}`}>
                      {t(`event.cat.${c}` as MessageKey, locale)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View className="gap-2">
            {label('event.create.type')}
            <View className="flex-row gap-2">
              {[false, true].map((online) => {
                const on = online === isOnline;
                return (
                  <Pressable
                    key={String(online)}
                    onPress={() => setIsOnline(online)}
                    className={`flex-1 items-center rounded-full border py-3 ${on ? 'border-aura-line bg-aura-soft' : 'border-hair bg-raise'}`}
                  >
                    <Text className={`text-[13px] ${on ? 'text-aura' : 'text-faint'}`}>
                      {t(online ? 'event.create.online' : 'event.create.inPerson', locale)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {isOnline ? (
            <View className="gap-2">
              {label('event.create.streamUrl')}
              <Input
                placeholder={t('event.create.streamUrlPlaceholder', locale)}
                value={streamUrl}
                onChangeText={setStreamUrl}
                autoCapitalize="none"
                keyboardType="url"
              />
            </View>
          ) : (
            <>
              <View className="gap-2">
                {label('event.create.venue')}
                <Input
                  placeholder={t('event.create.venuePlaceholder', locale)}
                  value={venue}
                  onChangeText={setVenue}
                  maxLength={240}
                />
              </View>
              <View className="gap-2">
                {label('event.create.city')}
                <Input
                  placeholder={t('event.create.cityPlaceholder', locale)}
                  value={city}
                  onChangeText={setCity}
                  maxLength={120}
                />
              </View>
              <Pressable
                onPress={() => void requestMyLocation()}
                className="self-start rounded-full border border-aura-line px-4 py-2"
                accessibilityRole="button"
              >
                <Text className="text-[13px] text-aura">
                  {coords
                    ? t('event.create.locationSet', locale)
                    : t('event.create.useLocation', locale)}
                </Text>
              </Pressable>
              {locationRefusal ? (
                <View className="gap-2">
                  {/* Literal keys on both arms (i18n checker + orphan-grep property). Blocked
                      takes the shared body per the candidacy precedent, which already tolerates
                      the Expo Go shared-grant route; the calendar's bespoke key is the recorded
                      exception (#552) — its «Add Events Only» axis has no location analog, and
                      the retry trigger (this pill) stays visible beside the notice. */}
                  <Text className="text-[13px] text-faint">
                    {locationRefusal === 'blocked'
                      ? t('permission.blocked.body', locale)
                      : t('event.create.locationDenied', locale)}
                  </Text>
                  {locationRefusal === 'blocked' ? (
                    <Button
                      label={t('permission.openSettings', locale)}
                      variant="ghost"
                      onPress={() => void Linking.openSettings()}
                    />
                  ) : null}
                </View>
              ) : null}
            </>
          )}

          <View className="gap-2">
            {label('event.create.datetime')}
            <Pressable
              onPress={() => setShowPicker(true)}
              className="rounded-card border border-hair bg-raise p-5"
            >
              <Text className="text-[15px] text-foreground">
                {dateTimeWithYear(startsAt.toISOString(), locale)}
              </Text>
            </Pressable>
            {showPicker ? (
              <DateTimePicker
                value={startsAt}
                mode="datetime"
                onChange={(_, d) => {
                  setShowPicker(Platform.OS === 'ios');
                  if (d) setStartsAt(d);
                }}
              />
            ) : null}
          </View>

          <View className="gap-2">
            {label('event.create.capacity')}
            <Input
              placeholder={t('event.create.capacityHint', locale)}
              value={capacity}
              onChangeText={(text) => setCapacity(text.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
            />
          </View>

          <View className="gap-2">
            {label('event.create.ticket')}
            <View className="flex-row gap-2">
              {[false, true].map((p) => {
                const on = p === paid;
                return (
                  <Pressable
                    key={String(p)}
                    onPress={() => setPaid(p)}
                    className={`flex-1 items-center rounded-full border py-3 ${on ? 'border-aura-line bg-aura-soft' : 'border-hair bg-raise'}`}
                  >
                    <Text className={`text-[13px] ${on ? 'text-aura' : 'text-faint'}`}>
                      {t(p ? 'event.create.paid' : 'event.create.free', locale)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {paid ? (
              <View className="gap-2">
                <Input
                  placeholder={t('event.create.pricePlaceholder', locale)}
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="decimal-pad"
                />
                {/* #437 — how the organiser gets paid, at the point the price is decided rather
                    than buried in terms. Neutral chrome on purpose: a settlement notice is not a
                    moment-grade event, so no cyan glow (rule #4), same argument as PriceToggle. */}
                <View className="gap-3 rounded-card border border-hair bg-raise p-5">
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: settlementAck }}
                    accessibilityLabel={t('event.create.settlement.ack', locale)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    className="min-h-[44px] flex-row items-center gap-3"
                    onPress={() => setSettlementAck((v) => !v)}
                  >
                    {/* ✓/○ — SHAPE carries the state, so the tick stays legible without relying
                        on colour (the MilestoneRow/BenefitRow vocabulary). */}
                    <Text
                      className={settlementAck ? 'text-base text-aura' : 'text-base text-faint'}
                    >
                      {settlementAck ? '✓' : '○'}
                    </Text>
                    <Text className="flex-1 text-[14px] leading-5 text-foreground">
                      {t('event.create.settlement.ack', locale)}
                    </Text>
                  </Pressable>
                  <Text className="text-[12px] leading-4 text-muted-foreground">
                    {t('event.create.settlement.manual', locale)}
                  </Text>
                </View>
                <Text className="text-[12px] text-aura">
                  {t('event.create.verifySoon', locale)}
                </Text>
              </View>
            ) : null}
          </View>

          {error ? <Text className="text-[13px] text-error">{error}</Text> : null}

          <Button
            label={t('event.create.submit', locale)}
            onPress={onSubmit}
            disabled={mutation.isPending}
            variant="light"
          />
        </ScrollView>
      </Screen>
    </KeyboardAvoiding>
  );
}
