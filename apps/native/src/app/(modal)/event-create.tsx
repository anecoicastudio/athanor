import { useCallback, useRef, useState } from 'react';
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
import {
  DEFAULT_TICKET_FEE_PCT,
  MIN_PAID_TICKET_CENTS,
  type EventPointSource,
  type GeoPoint,
  type VenueLookup,
  type VenuePoint,
  eventPointState,
  formatEuroAmount,
  parseEuroToCents,
  shouldLookUpVenue,
  snapToEventGrid,
  venueQuery,
} from '@athanor/core';
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
import { useLocationConsent } from '@/hooks/use-location-consent';
import { useLocale } from '@/hooks/use-locale';
import { usePaidEventsGate } from '@/hooks/use-remote-config';
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
  /**
   * The event's point (#781, ruling 2026-09-19 evening): the typed venue + city, geocoded on the
   * phone by the OS geocoder and snapped to the event grid, with the organiser's own rounded
   * position as the fallback they choose with «Usa la mia posizione». `eventPointState` decides
   * which one the event is saved with and what the line under the city says — never the phone
   * position silently standing in for a venue the geocoder could not find.
   */
  const [venuePoint, setVenuePoint] = useState<VenuePoint | null>(null);
  const [devicePoint, setDevicePoint] = useState<GeoPoint | null>(null);
  const [pointSource, setPointSource] = useState<EventPointSource | null>(null);
  const [lookup, setLookup] = useState<VenueLookup>({ state: 'idle', query: null });
  // The query the newest lookup was started for: an older lookup that lands late must not
  // overwrite the answer to what is typed now.
  const latestLookup = useRef<string | null>(null);
  // The lookup in flight, so «Pubblica» tapped mid-lookup waits for its answer instead of refusing.
  const inflight = useRef<{ query: string; answer: Promise<GeoPoint | null> } | null>(null);
  const [streamUrl, setStreamUrl] = useState('');
  const [startsAt, setStartsAt] = useState<Date>(() => new Date(Date.now() + 7 * 86400000));
  const [showPicker, setShowPicker] = useState(false);
  const [capacity, setCapacity] = useState('');
  /**
   * #806 — the platform-wide paid-events switch, the same `remote_config` row that
   * create-ticket-checkout and create-payout-onboarding read first. Fails closed; `'loading'`
   * is neither, so the toggle shows a spinner rather than flashing a state.
   */
  const paidGate = usePaidEventsGate();
  /**
   * «Localizzazione approssimativa» (#783): «Usa la mia posizione» exists only while it is `on`.
   * Off, the event's point comes from the typed venue alone — the OS geocoder reads no position,
   * though on Android it still needs the OS grant (see geocodeVenue).
   */
  // A failed consent read stays `unknown`: the pill stays hidden and the typed venue still works.
  const locationConsent = useLocationConsent().state;
  /**
   * What the organiser PICKED, and what the form actually IS — two different things since #806,
   * because the rail can close while this sheet is open (a 60s refetch, or a flag flipped
   * mid-session). `paid` is DERIVED rather than reset by an effect: an effect that called
   * setPaid would be a cascading render the React compiler rejects, and more to the point the
   * truth here is a function of two inputs, so storing it would be storing a stale copy of one.
   *
   * Everything downstream reads `paid`, so a closed rail takes the price field, the settlement
   * box and the paid half of the payload with it in one step. The pick survives, so a rail that
   * reopens restores the organiser's choice rather than silently keeping them on free.
   */
  const [paidSelected, setPaidSelected] = useState(false);
  const paid = paidGate === 'open' && paidSelected;
  const [price, setPrice] = useState('');
  // #437 — the settlement acknowledgement. UNTICKED, always, and never remembered: CRD 2011/83/EU
  // Art. 22 excludes pre-ticked boxes, and a remembered tick is a pre-ticked box wearing a
  // different name (the same reasoning as fund-disclosure.tsx's coverage box). Per event, because
  // the 14-day promise attaches to an event rather than to the organiser.
  const [settlementAck, setSettlementAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * #701 — the paid-ticket floor, as one sentence used twice: a hint under the price field, and
   * the refusal when the field is ignored. Derived at render rather than stored, so it survives a
   * locale flip (#531's argument), and the figure is INTERPOLATED from the constant the mirror
   * test pins against the CHECK — a literal «5» in the catalog would be a term that goes stale
   * silently, which is the same reason `settlement.ack` interpolates its percentage.
   */
  const minPriceMessage = t('event.create.price.min', locale, {
    min: formatEuroAmount(MIN_PAID_TICKET_CENTS, locale),
  });
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
    venuePoint: null,
    devicePoint: null,
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
  /**
   * SUBMITTED, not "a row exists". create-payout-onboarding inserts the payout_accounts row right
   * after accounts.create and BEFORE it returns the Account Link, so `hasAccount` is already true on
   * the first tap of the CTA — before the organiser has typed a character into Stripe's form. Gating
   * the "Stripe is still checking" line on that would tell someone who opened the sheet and dismissed
   * it that we are reviewing an application they never filed. `onboarded_at` is the field that
   * separates the two: W13 stamps it on the first account.updated carrying details_submitted.
   */
  const payoutSubmitted = payoutQuery.data?.onboardedAt != null;
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
      // The server's refusal codes are the contract (#103's shape). `paid events closed` (#806)
      // is the rail switch: the same sentence the toggle shows, never «non riesco ad aprire
      // Stripe», which would describe a fault where there is a deliberate closure.
      const code = e instanceof PayoutOnboardingError ? e.code : null;
      const key: MessageKey =
        code === 'identity not verified'
          ? 'event.create.verifyGate'
          : code === 'paid events closed'
            ? 'event.create.paidClosed'
            : 'event.create.payout.error';
      setError(t(key, locale));
    } finally {
      setPayoutOpening(false);
    }
  }, [locale, queryClient]);

  // A point arriving answers the «Scrivi luogo e città…» refusal, and only that one: any other
  // error is about a different field and stays until the next submit re-checks it.
  const clearLocationError = () =>
    setError((current) => (current === t('event.create.locationNeeded', locale) ? null : current));

  const requestMyLocation = async () => {
    if (locationConsent !== 'on') return;
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
      // Lowest (#781): PRIORITY_LOW_POWER on Android, kCLLocationAccuracyThreeKilometers on iOS.
      // The Android manifest now carries only ACCESS_COARSE_LOCATION, so there it is also the
      // most the OS will hand over.
      pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest });
    } catch (e) {
      // Services off / a fix that timed out: this rejection escaped `void requestMyLocation()`
      // unhandled — the second silent path. Same recovery as VicinoPanel's #179: say so with a
      // toast; the pill itself is the retry.
      devWarn('[event-create] requestMyLocation', e);
      showToast(t('live.map.locationError', locale));
      return;
    }
    // Snapped here, before the point reaches the OS geocoder or create_event: the event's point
    // is the grid cell, never the organiser's phone (#781). events_snap_geo snaps it again on
    // the table with the same arithmetic, so what is stored is exactly what was sent.
    const fix = snapToEventGrid({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    setDevicePoint(fix);
    setPointSource('device');
    clearLocationError();
    try {
      const [place] = await Location.reverseGeocodeAsync({
        latitude: fix.lat,
        longitude: fix.lng,
      });
      if (place?.city && !city) setCity(place.city);
    } catch (e) {
      devWarn('[event-create] reverseGeocode', e);
      // label nicety only
    }
  };

  const query = venueQuery(venue, city);
  const { point, status: pointStatus } = eventPointState({
    query,
    venue: venuePoint,
    // A fix taken before the switch went off is never saved after it (#783).
    device: locationConsent === 'on' ? devicePoint : null,
    source: pointSource,
    lookup,
  });

  /**
   * Looks the typed venue up with the OS geocoder — Apple's on iOS, Google's on Android — and snaps
   * the answer to the event grid before it goes anywhere else. Nothing else is sent: no third-party
   * geocoder, no key. What it cannot do is said on screen (the line under the city), and the phone
   * position stays one tap away rather than being used behind the organiser's back.
   *
   * Android only: expo-location's geocoder refuses without a foreground location grant
   * (`LocationModule.kt` `geocode` → LocationUnauthorizedException), so the same approximate-location
   * prompt comes first. iOS's CLGeocoder needs no grant. On web `geocodeAsync` returns `[]`, which
   * lands on the not-found line with «Usa la mia posizione» beside it.
   */
  const geocodeVenue = async (q: string): Promise<GeoPoint | null> => {
    latestLookup.current = q;
    setLookup({ state: 'looking', query: q });
    const settle = (next: VenueLookup) => {
      if (latestLookup.current === q) setLookup(next);
    };
    try {
      if (Platform.OS === 'android') {
        const res = await Location.requestForegroundPermissionsAsync();
        if (!res.granted) {
          setLocationRefusal(toStatus(res) === 'blocked' ? 'blocked' : 'denied');
          settle({ state: 'failed', query: q });
          return null;
        }
      }
      const [hit] = await Location.geocodeAsync(q);
      if (!hit) {
        settle({ state: 'notFound', query: q });
        return null;
      }
      const found = snapToEventGrid({ lat: hit.latitude, lng: hit.longitude });
      if (latestLookup.current === q) {
        setVenuePoint({ query: q, point: found });
        setPointSource('venue');
        setLookup({ state: 'idle', query: null });
        clearLocationError();
      }
      return found;
    } catch (e) {
      devWarn('[event-create] geocode', e);
      settle({ state: 'failed', query: q });
      return null;
    }
  };

  const lookUpVenue = (q: string): Promise<GeoPoint | null> => {
    const answer = geocodeVenue(q);
    inflight.current = { query: q, answer };
    return answer;
  };

  // Venue and city are looked up when the organiser leaves either field, so the point is on
  // screen before they reach «Pubblica»; onSubmit catches a form sent straight from the keyboard.
  const lookUpIfNeeded = () => {
    if (query !== null && shouldLookUpVenue(query, venuePoint, lookup)) void lookUpVenue(query);
  };

  const mutation = useMutation({
    mutationFn: async (at: GeoPoint | null) => {
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
        lat: at?.lat ?? null,
        long: at?.lng ?? null,
        stream_url: isOnline ? streamUrl || null : null,
        starts_at: startsAt.toISOString(),
        ends_at: null,
        capacity: capacity ? Number(capacity) : null,
        // Floor 0, named: a ticket may be free, unlike a fund contribution, whose €1 minimum is
        // the parser's default (#387). The column rule is now the BAND `price_cents = 0 or >= 500`
        // (#701, events_price_min) — 0 stays the right floor HERE because onSubmit has already
        // refused everything between the two, so what reaches this line is free or legal.
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
      // #701 — 22003 is the floor arm, raised by create_event and by the insert trigger alike so
      // one mapping covers both write paths. The bare events_price_min CHECK raises 23514 instead
      // and is deliberately NOT mapped: no path in this app updates a price, and every other CHECK on
      // `events` shares that code, so an arm on it would mis-describe them.
      // 22003 is not unique either — PostgREST raises it casting an out-of-int4 p_capacity — which
      // is why eventCreateSchema bounds capacity (MAX_EVENT_CAPACITY). Remove that and this arm
      // starts answering overflows with price copy.
      if (code === '22003') return setError(minPriceMessage);
      if (code === '55000') return setError(t('event.create.payout.gate', locale));
      if (code === '42501') return setError(t('event.create.verifyGate', locale));
      setError(t('event.create.error', locale));
    },
  });

  const onSubmit = async () => {
    setError(null);
    // The four paid-event refusals, in the order BOTH server gates raise them: price floor
    // (22003), acknowledgement (22023), then identity (42501), then payout (55000). The order is
    // the point, not a detail — checking payout first would send a verified organiser who simply
    // had not ticked the box through an entire Stripe onboarding flow, and only then tell them to
    // tick it.
    //
    // #701 is first because it is the only one about the FIELD in front of them, and because the
    // acknowledgement below quotes a split of the price: asking someone to consent to ten percent
    // of a figure the server will refuse is asking them to agree to nothing. It must also run
    // BEFORE mutation.mutate(), because eventCreateSchema now refuses the same band — a ZodError
    // carries no `code`, so onError would fall through to the generic «Riprova» and this copy
    // would be unreachable.
    // `minCents` rather than a comparison: the parser returns null for a blank, a malformed
    // amount AND anything under the floor, which are the three inputs this sentence answers.
    // Comparing `parseEuroToCents(price, 0) < MIN_PAID_TICKET_CENTS` would lean on `null` coercing
    // to 0 — true today, and a silent hole the day the parser returns undefined instead.
    // #806 — the rail itself, ahead of all four, and it reads the PICK rather than the derived
    // `paid`. That is the point: with the rail closed `paid` is already false, so without this a
    // «Pubblica» tapped on a form filled in for a paid event would quietly publish it as FREE —
    // at the organiser's own price, for nothing. Say it instead.
    if (paidSelected && paidGate !== 'open') {
      setError(t('event.create.paidClosed', locale));
      return;
    }
    if (paid && parseEuroToCents(price, MIN_PAID_TICKET_CENTS) === null) {
      setError(minPriceMessage);
      return;
    }
    if (paid && !settlementAck) {
      setError(t('event.create.settlement.required', locale));
      return;
    }
    // Verification has shipped (#416 closed), so a verified organizer was being refused with copy
    // promising verification «presto» (#634 item 4). Mirrors create_event's is_identity_verified
    // refusal; the server one is the load-bearing gate.
    if (paid && !profile?.identity_verified) {
      setError(t('event.create.verifyGate', locale));
      return;
    }
    // #104 — mirrors create_event's own 55000 refusal. `payoutKnown` keeps a still-loading read from
    // refusing a submit the server would allow; the server gate is load-bearing either way.
    if (paid && payoutKnown && !payoutsEnabled) {
      setError(t('event.create.payout.gate', locale));
      return;
    }
    if (title.trim().length === 0) return setError(t('event.create.error', locale));
    if (isOnline) return mutation.mutate(null);
    // A venue typed and sent without leaving the field has not been looked up yet: do it now, and
    // save with the answer. No answer means no point — the line under the city already says why.
    const pending = inflight.current;
    const at =
      point ??
      (query === null
        ? null
        : lookup.state === 'looking' && pending?.query === query
          ? await pending.answer
          : shouldLookUpVenue(query, venuePoint, lookup)
            ? await lookUpVenue(query)
            : null);
    if (!at) return setError(t('event.create.locationNeeded', locale));
    mutation.mutate(at);
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
      venuePoint,
      devicePoint,
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
        {/* `handled`: the first tap on a chip or on the submit lands on it instead of only
            dismissing the keyboard — on the capacity and price pads, which have no return key
            on iOS, tapping out is the only other way down (#766). */}
        <ScrollView
          {...reveal.scrollProps}
          className="flex-1"
          contentContainerClassName="gap-5 px-5 pb-16"
          keyboardShouldPersistTaps="handled"
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
                  onEndEditing={lookUpIfNeeded}
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
                  onEndEditing={lookUpIfNeeded}
                  maxLength={120}
                />
                {/* Where the point comes from, always said (#781): the venue that was found, the
                    phone position the organiser chose, or why neither is there yet. Literal keys
                    on every arm for the i18n checker. Neutral chrome — finding a place is not a
                    moment-grade event (rule #4). */}
                <Text
                  className="text-[13px] text-muted-foreground"
                  accessibilityLiveRegion="polite"
                >
                  {pointStatus === 'venue'
                    ? t('event.create.point.venue', locale, { place: query ?? '' })
                    : pointStatus === 'device'
                      ? t('event.create.point.device', locale)
                      : pointStatus === 'looking'
                        ? t('event.create.point.looking', locale)
                        : pointStatus === 'notFound'
                          ? t('event.create.point.notFound', locale, { place: query ?? '' })
                          : pointStatus === 'failed'
                            ? t('event.create.point.failed', locale)
                            : t('event.create.point.hint', locale)}
                </Text>
              </View>
              {locationConsent === 'on' ? (
                <Pressable
                  onPress={() => void requestMyLocation()}
                  className="self-start rounded-full border border-aura-line px-4 py-2"
                  accessibilityRole="button"
                >
                  <Text className="text-[13px] text-aura">
                    {pointStatus === 'device'
                      ? t('event.create.locationSet', locale)
                      : t('event.create.useLocation', locale)}
                  </Text>
                </Pressable>
              ) : locationConsent === 'off' ? (
                <Text className="text-[13px] text-faint">
                  {t('event.create.locationOff', locale)}
                </Text>
              ) : null}
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
            {/* #806 — the Paid option is OFFERED only on an open rail: the choice disappears
                rather than being shown and then refused. Free is always in the list, in every
                gate state — a closed or still-loading paid rail must not cost anyone the ability
                to list a free event, which is most of them. That is why this is not a spinner:
                one would take the Free chip away too, and under a paused offline fetch it would
                never come back. The closed LINE is what waits for the read (below), so nothing
                claims «non ancora aperti» before anything has been read. */}
            <View className="flex-row gap-2">
              {(paidGate === 'open' ? [false, true] : [false]).map((p) => (
                <Chip
                  key={String(p)}
                  className="flex-1 items-center"
                  label={t(p ? 'event.create.paid' : 'event.create.free', locale)}
                  selected={p === paid}
                  onPress={() => setPaidSelected(p)}
                />
              ))}
            </View>
            {/* One honest line, in the same muted treatment as the floor hint and the verify note:
                a rail that is not open yet is a fact about the world, not an error the organiser
                made (rule #4 — no cyan, no glow). */}
            {paidGate === 'closed' ? (
              <Text className="text-[12px] leading-4 text-muted-foreground">
                {t('event.create.paidClosed', locale)}
              </Text>
            ) : null}
            {paid ? (
              <View className="gap-2" ref={reveal.rowRef('price')}>
                <Input
                  {...reveal.fieldProps('price')}
                  placeholder={t('event.create.pricePlaceholder', locale)}
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="decimal-pad"
                />
                {/* #701 — the floor, stated where the number is typed rather than only after it is
                    refused. Same muted treatment as the settlement note below: a pricing rule is
                    not a moment-grade event, so no cyan and no glow (rule #4). */}
                <Text className="text-[12px] leading-4 text-muted-foreground">
                  {minPriceMessage}
                </Text>
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
                    {/* Submitted but not yet enabled means Stripe is still reviewing: telling that
                        organiser to "connect an account" would send them back through a flow they
                        have already finished. An abandoned first tap shows the plain CTA instead. */}
                    {payoutSubmitted ? (
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

          {/* Revealed with the focused row whenever the two fit (#766) — see the same block in
              (auth)/welcome.tsx. It matters most on the last fields: capacity and price are
              number pads, so there is no return key to send from. A tall row (the price with
              its settlement box) is revealed alone, and the list still scrolls to the button. */}
          <View ref={reveal.submitRef()}>
            <Button
              label={t('event.create.submit', locale)}
              onPress={() => void onSubmit()}
              disabled={mutation.isPending}
              variant="light"
            />
          </View>
        </ScrollView>
      </Screen>
    </KeyboardAvoiding>
  );
}
