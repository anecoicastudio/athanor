import { useCallback, useState } from 'react';
import { Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { KeyboardAvoiding } from '@/components/KeyboardAvoiding';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PayoutOnboardingError,
  createEvent,
  eventKeys,
  getMyPayoutAccount,
  payoutKeys,
  requestPayoutOnboarding,
} from '@athanor/api';
import { type MessageKey, t } from '@athanor/i18n';
import { DEFAULT_TICKET_FEE_PCT, parseEuroToCents } from '@athanor/core';
import { type EventCategory, eventCreateSchema } from '@athanor/schemas';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { EVENT_HREF } from '@/components/live/EventRow';
import { Input } from '@/components/Input';
import { ModalHeader } from '@/components/ModalHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { useToast } from '@/components/ToastHost';
import { useDirtyGuard } from '@/hooks/use-dirty-guard';
import { useLocale } from '@/hooks/use-locale';
import { useRevealOnFocus } from '@/hooks/use-reveal-on-focus';
import { isDraftDirty } from '@/lib/dirty-guard';
import { useAuth } from '@/lib/auth-context';
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
  // The longest form in the app — seven fields, so most of them are below the fold with the
  // keyboard up. Same recipe as the auth screens (#689); `(auth)/welcome.tsx` explains it.
  const reveal = useRevealOnFocus();
  const { profile } = useAuth();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
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
  /**
   * #636. Seventeen `useState`s, one of them a `Date` seeded from the clock — so the baseline
   * is captured by a state INITIALISER rather than rebuilt inline. Re-running
   * `new Date(Date.now() + …)` for the comparison would produce an instant a few milliseconds
   * from `startsAt` and report an untouched form as edited on its first render.
   */
  const [baseline] = useState(() => ({
    title: '',
    description: '',
    category: 'networking',
    isOnline: false,
    venue: '',
    city: '',
    coords: null,
    streamUrl: '',
    startsAt,
    capacity: '',
    paid: false,
    price: '',
    settlementAck: false,
  }));

  const { showToast } = useToast();

  /**
   * #104 — a paid event now needs a connected account that can receive payouts, because the ticket
   * Checkout Session names it as the destination of a split payment. The server holds the real
   * gate (create_event raises 55000, and the trigger raises it on the direct path too); this read
   * exists so the organiser is told BEFORE they fill in a form they cannot submit.
   *
   * `enabled` on `paid`: a free event never touches any of this, and most events are free.
   *
   * `persist: false` is load-bearing, not tuning. The shared client dehydrates every query to
   * device storage with a 24h gcTime (`lib/query-client.ts`), so without it a launch would rehydrate
   * yesterday's flag and paint a stale "you're all set" over an account Stripe has since put back
   * into review — the money-state rule the Circle price read follows for the same reason.
   */
  const payoutQuery = useQuery({
    queryKey: payoutKeys.mine(),
    queryFn: () => getMyPayoutAccount(supabase),
    enabled: paid,
    staleTime: 30_000,
    meta: { persist: false },
  });
  const payoutsEnabled = payoutQuery.data?.payoutsEnabled ?? false;
  const payoutStarted = payoutQuery.data?.hasAccount ?? false;
  // Unknown is not "missing": while the first read is in flight the CTA stays hidden rather than
  // accusing an already-onboarded organiser of not having a bank account.
  const payoutKnown = payoutQuery.isSuccess;
  const [payoutOpening, setPayoutOpening] = useState(false);

  /**
   * The flag is flipped by stripe-webhook's account.updated arm (W13), not by the redirect, so
   * coming back from Stripe proves nothing on its own. Refetching on focus is what makes the CTA
   * disappear once the webhook has actually landed — and it also covers the case where Stripe
   * finished the review hours later, with the composer left open.
   */
  useFocusEffect(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: payoutKeys.mine() });
    }, [queryClient]),
  );

  /**
   * Opens Stripe's hosted Express onboarding. `openAuthSessionAsync`, never a native Stripe module:
   * a native module breaks App Store Expo Go, which is the only way this app reaches testers
   * (rules/mobile.md). Account Links are single-use and expire in minutes, so the URL is minted per
   * tap and never cached.
   */
  const startPayoutOnboarding = useCallback(async () => {
    setError(null);
    setPayoutOpening(true);
    try {
      const { url } = await requestPayoutOnboarding(supabase);
      await WebBrowser.openAuthSessionAsync(url, 'athanor://payout');
      // Returned — completed OR cancelled, the browser cannot tell us which. The refetch decides.
      void queryClient.invalidateQueries({ queryKey: payoutKeys.mine() });
    } catch (e) {
      devWarn('[event-create] payout onboarding', e);
      setError(
        t(
          e instanceof PayoutOnboardingError && e.code === 'identity not verified'
            ? 'event.create.verifyGate'
            : 'event.create.payout.error',
          locale,
        ),
      );
    } finally {
      setPayoutOpening(false);
    }
  }, [locale, queryClient]);

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
        // The schema trims and turns blank into null — a null renders as NOTHING on the
        // detail, which is the whole point of #634: no more fabricated fallback paragraph.
        description,
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
    onError: (e) => {
      // The server is the real gate, and its refusals must not all read as «Riprova». 55000 is
      // #104's payout arm (create_event and the trigger raise the same code on both write paths);
      // 42501 is the identity arm. PostgREST carries the SQLSTATE through as `code`.
      const code = (e as { code?: unknown } | null)?.code;
      if (code === '55000') return setError(t('event.create.payout.gate', locale));
      if (code === '42501') return setError(t('event.create.verifyGate', locale));
      setError(t('event.create.error', locale));
    },
  });

  const onSubmit = () => {
    setError(null);
    // Paid events require verified identity (PRD §4.13). The gate used to block EVERY paid
    // event «pending M9» — but verification has shipped (#416 closed), so a verified organizer
    // was being refused with copy promising verification «presto» (#634 item 4). The client
    // check mirrors create_event's own is_identity_verified refusal; the server one is the
    // load-bearing gate.
    if (paid && !profile?.identity_verified) {
      setError(t('event.create.verifyGate', locale));
      return;
    }
    // #104 — mirrors create_event's own 55000 refusal. Placed AFTER the identity gate and before
    // the acknowledgement, exactly the order both server gates declare, so the first thing an
    // organiser is told is the first thing the server would have told them.
    // `payoutKnown` keeps a still-loading read from refusing a submit the server would allow; the
    // server gate is the load-bearing one either way.
    if (paid && payoutKnown && !payoutsEnabled) {
      setError(t('event.create.payout.gate', locale));
      return;
    }
    if (paid && !settlementAck) {
      setError(t('event.create.settlement.required', locale));
      return;
    }
    if (title.trim().length === 0) return setError(t('event.create.error', locale));
    if (!isOnline && !coords) return setError(t('event.create.locationNeeded', locale));
    mutation.mutate();
  };

  const label = (key: MessageKey) => <SectionLabel>{t(key, locale)}</SectionLabel>;

  useDirtyGuard({
    dirty: isDraftDirty(baseline, {
      title,
      description,
      category,
      isOnline,
      venue,
      city,
      coords,
      streamUrl,
      startsAt,
      capacity,
      paid,
      price,
      settlementAck,
    }),
    saving: mutation.isPending,
    submitted: mutation.isSuccess,
  });

  return (
    <KeyboardAvoiding>
      <Screen>
        <ModalHeader title={t('event.create.title', locale)} backLabel={t('common.back', locale)} />
        <ScrollView
          {...reveal.scrollProps}
          className="flex-1"
          contentContainerClassName="gap-5 px-5 pb-16"
        >
          <View className="gap-2" ref={reveal.rowRef('name')}>
            {label('event.create.name')}
            <Input
              {...reveal.fieldProps('name')}
              placeholder={t('event.create.namePlaceholder', locale)}
              value={title}
              onChangeText={setTitle}
              maxLength={140}
            />
          </View>

          {/* #634: the detail used to render one fabricated sentence for every event under the
              organizer's name. These are the organizer's own words instead; optional, because
              an absent paragraph asserts nothing. */}
          <View className="gap-2" ref={reveal.rowRef('desc')}>
            {label('event.create.desc')}
            <Input
              {...reveal.fieldProps('desc')}
              placeholder={t('event.create.descPlaceholder', locale)}
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={2000}
              className="min-h-[120px]"
            />
          </View>

          <View className="gap-2">
            {label('event.create.category')}
            <View className="flex-row flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <Chip
                  key={c}
                  small
                  label={t(`event.cat.${c}` as MessageKey, locale)}
                  selected={c === category}
                  onPress={() => setCategory(c)}
                />
              ))}
            </View>
          </View>

          <View className="gap-2">
            {label('event.create.type')}
            <View className="flex-row gap-2">
              {[false, true].map((online) => (
                <Chip
                  key={String(online)}
                  className="flex-1 items-center"
                  label={t(online ? 'event.create.online' : 'event.create.inPerson', locale)}
                  selected={online === isOnline}
                  onPress={() => setIsOnline(online)}
                />
              ))}
            </View>
          </View>

          {isOnline ? (
            <View className="gap-2" ref={reveal.rowRef('streamUrl')}>
              {label('event.create.streamUrl')}
              <Input
                {...reveal.fieldProps('streamUrl')}
                placeholder={t('event.create.streamUrlPlaceholder', locale)}
                value={streamUrl}
                onChangeText={setStreamUrl}
                autoCapitalize="none"
                keyboardType="url"
              />
            </View>
          ) : (
            <>
              <View className="gap-2" ref={reveal.rowRef('venue')}>
                {label('event.create.venue')}
                <Input
                  {...reveal.fieldProps('venue')}
                  placeholder={t('event.create.venuePlaceholder', locale)}
                  value={venue}
                  onChangeText={setVenue}
                  maxLength={240}
                />
              </View>
              <View className="gap-2" ref={reveal.rowRef('city')}>
                {label('event.create.city')}
                <Input
                  {...reveal.fieldProps('city')}
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

          <View className="gap-2" ref={reveal.rowRef('capacity')}>
            {label('event.create.capacity')}
            <Input
              {...reveal.fieldProps('capacity')}
              placeholder={t('event.create.capacityHint', locale)}
              value={capacity}
              onChangeText={(text) => setCapacity(text.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
            />
          </View>

          <View className="gap-2">
            {label('event.create.ticket')}
            <View className="flex-row gap-2">
              {[false, true].map((p) => (
                <Chip
                  key={String(p)}
                  className="flex-1 items-center"
                  label={t(p ? 'event.create.paid' : 'event.create.free', locale)}
                  selected={p === paid}
                  onPress={() => setPaid(p)}
                />
              ))}
            </View>
            {paid ? (
              <View className="gap-2" ref={reveal.rowRef('price')}>
                <Input
                  {...reveal.fieldProps('price')}
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
                    accessibilityLabel={t('event.create.settlement.ack', locale, {
                      pct: DEFAULT_TICKET_FEE_PCT,
                    })}
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
                      {/* The rate comes from the constant the mirror test pins against the
                          events.fee_pct column default — never a literal in the catalog, because a
                          percentage inside a consent box is a term and a stale term is a false one. */}
                      {t('event.create.settlement.ack', locale, { pct: DEFAULT_TICKET_FEE_PCT })}
                    </Text>
                  </Pressable>
                  <Text className="text-[12px] leading-4 text-muted-foreground">
                    {t('event.create.settlement.split', locale)}
                  </Text>
                </View>

                {/* #104 — the account the split pays into. Shown only once the read has landed, so
                    an already-onboarded organiser never sees an accusation; and only while the flag
                    is false, so it disappears the moment W13 flips it. Flat cyan CTA, no glow:
                    connecting a bank account is a chore, not a moment-grade event (rule #4). */}
                {payoutKnown && !payoutsEnabled ? (
                  <View className="gap-3 rounded-card border border-hair bg-raise p-5">
                    <Text className="text-[14px] leading-5 text-foreground">
                      {t('event.create.payout.gate', locale)}
                    </Text>
                    {/* A row that exists but is not enabled means Stripe is still reviewing:
                        telling that organiser to "connect an account" would send them back through
                        a flow they have already finished. */}
                    {payoutStarted ? (
                      <Text className="text-[12px] leading-4 text-muted-foreground">
                        {t('event.create.payout.pending', locale)}
                      </Text>
                    ) : null}
                    <Button
                      variant="light"
                      label={t(
                        payoutOpening ? 'event.create.payout.opening' : 'event.create.payout.cta',
                        locale,
                      )}
                      disabled={payoutOpening}
                      onPress={() => void startPayoutOnboarding()}
                    />
                  </View>
                ) : null}
                {/* #634: «la verifica arriva presto» was a falsehood once #416 shipped it. An
                    unverified organizer is told the actual requirement before submit; a
                    verified one is told nothing. */}
                {!profile?.identity_verified ? (
                  <Text className="text-[12px] leading-4 text-muted-foreground">
                    {t('event.create.verifyGate', locale)}
                  </Text>
                ) : null}
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
