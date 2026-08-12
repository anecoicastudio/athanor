import { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createEvent, eventKeys } from '@athanor/api';
import { semantic } from '@athanor/config';
import { type MessageKey, t } from '@athanor/i18n';
import { type EventCategory, eventCreateSchema } from '@athanor/schemas';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
import { EVENT_HREF } from '@/components/live/EventRow';
import { ModalHeader } from '@/components/ModalHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { useAuth } from '@/lib/auth-context';
import { devWarn } from '@/lib/log';
import { supabase } from '@/lib/supabase';
import { dateTimeWithYear } from '@/lib/time';
import { parsePriceCents } from '@/lib/price';
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
  const { profile } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const locale = profile?.locale ?? 'it';

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
  const [error, setError] = useState<string | null>(null);

  const requestMyLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
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
        city: isOnline ? null : city || null,
        lat: isOnline ? null : (coords?.lat ?? null),
        long: isOnline ? null : (coords?.lng ?? null),
        stream_url: isOnline ? streamUrl || null : null,
        starts_at: startsAt.toISOString(),
        ends_at: null,
        capacity: capacity ? Number(capacity) : null,
        price_cents: paid && price ? parsePriceCents(price) : 0,
        currency: 'eur',
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
    if (title.trim().length === 0) return setError(t('event.create.error', locale));
    if (!isOnline && !coords) return setError(t('event.create.locationNeeded', locale));
    mutation.mutate();
  };

  const label = (key: MessageKey) => <SectionLabel>{t(key, locale)}</SectionLabel>;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen>
        <ModalHeader title={t('event.create.title', locale)} backLabel={t('common.back', locale)} />
        <ScrollView className="flex-1" contentContainerClassName="gap-5 px-5 pb-16">
          <View className="gap-2">
            {label('event.create.name')}
            <TextInput
              className="rounded-full border border-hair bg-raise p-5 text-[15px] text-foreground"
              placeholder={t('event.create.namePlaceholder', locale)}
              placeholderTextColor={semantic.foregroundMuted}
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
              <TextInput
                className="rounded-full border border-hair bg-raise p-5 text-[15px] text-foreground"
                placeholder={t('event.create.streamUrlPlaceholder', locale)}
                placeholderTextColor={semantic.foregroundMuted}
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
                <TextInput
                  className="rounded-full border border-hair bg-raise p-5 text-[15px] text-foreground"
                  placeholder={t('event.create.venuePlaceholder', locale)}
                  placeholderTextColor={semantic.foregroundMuted}
                  value={venue}
                  onChangeText={setVenue}
                  maxLength={240}
                />
              </View>
              <View className="gap-2">
                {label('event.create.city')}
                <TextInput
                  className="rounded-full border border-hair bg-raise p-5 text-[15px] text-foreground"
                  placeholder={t('event.create.cityPlaceholder', locale)}
                  placeholderTextColor={semantic.foregroundMuted}
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
            <TextInput
              className="rounded-full border border-hair bg-raise p-5 text-[15px] text-foreground"
              placeholder={t('event.create.capacityHint', locale)}
              placeholderTextColor={semantic.foregroundMuted}
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
                <TextInput
                  className="rounded-full border border-hair bg-raise p-5 text-[15px] text-foreground"
                  placeholder={t('event.create.pricePlaceholder', locale)}
                  placeholderTextColor={semantic.foregroundMuted}
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="decimal-pad"
                />
                <Text className="text-[12px] text-faint">{t('event.create.feeNote', locale)}</Text>
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
    </KeyboardAvoidingView>
  );
}
