import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Linking } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  eventKeys,
  getEvent,
  getEventAttendees,
  getEventSeatsTaken,
  getMyRsvp,
  subscribeEventPresence,
  upsertRsvp,
} from '@athanor/api';
import { semantic } from '@athanor/config';
import { ENGINE_WEIGHTS } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Rsvp } from '@athanor/schemas';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { ModalHeader } from '@/components/ModalHeader';
import { EventCover } from '@/components/live/EventCover';
import { DmetaRow } from '@/components/live/DmetaRow';
import { AttendeeStack } from '@/components/live/AttendeeStack';
import { RsvpBar } from '@/components/live/RsvpBar';
import { SectionLabel } from '@/components/SectionLabel';
import { TicketBar } from '@/components/live/TicketBar';
import { CircleGate } from '@/components/circle/CircleGate';
import { ListState } from '@/components/ListState';
import { PostAuthorRow } from '@/components/feed/PostAuthorRow';
import { useLocale } from '@/hooks/use-locale';
import { useAuth } from '@/lib/auth-context';
import { listState } from '@/lib/list-state';
import { supabase } from '@/lib/supabase';
import { addEventToCalendar } from '@/lib/calendar';
import { dateTime } from '@/lib/time';
import { Screen } from '@/components/Screen';

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const locale = useLocale();
  const uid = profile?.id ?? null;
  const [confirmation, setConfirmation] = useState<string | null>(null);
  /**
   * Why «Calendario» did nothing (#531). Separate state from `confirmation`, and deliberately
   * NOT on its 2.5s timer: a line that offers the only route back to a working button must not
   * vanish while it is being read. Cleared when the member acts — a new RSVP toggle or another
   * calendar tap.
   *
   * The OUTCOME is stored, not the sentence. Because this notice has no timer, it can still be
   * on screen when the member changes language in Settings — a sibling in the same stack, so
   * this screen stays mounted and `useLocale()` flips under it. A stored string would keep
   * rendering the previous language while everything around it changed; deriving it here keeps
   * it in step. Both keys stay spelled literally at the call site, which is the property the
   * i18n checker and an orphan grep depend on.
   */
  const [calendarNotice, setCalendarNotice] = useState<'denied' | 'blocked' | null>(null);
  /**
   * «Calendario» in-flight gate (#548). The ref is the gate — synchronous, so two taps in the
   * same JS tick cannot both pass it (state alone lags a render; MediaSheet's `launchLock` is
   * the precedent). The state drives the Button's `loading`, which implies disabled. Without
   * this, `Calendar.createEventAsync` has no dedupe and a double-tap stores two iOS events.
   */
  const calendarInFlight = useRef(false);
  const [calendarPending, setCalendarPending] = useState(false);
  // Auto-dismiss the inline confirmation so it never lingers under an idle bar (no toast host yet).
  useEffect(() => {
    if (!confirmation) return;
    const handle = setTimeout(() => setConfirmation(null), 2500);
    return () => clearTimeout(handle);
  }, [confirmation]);

  const query = useQuery({
    queryKey: eventKeys.detail(id),
    queryFn: () => getEvent(supabase, id),
    enabled: !!id,
  });
  const event = query.data;
  // `staleWins`: an event card an hour old is still that event, and the detail screen is where
  // a member lands from a push or a deep link — blanking it on a lost refresh helps nobody.
  const detailState = listState({
    status: query.status,
    fetchStatus: query.fetchStatus,
    isEmpty: event == null,
    staleWins: true,
  });

  const attendees = useQuery({
    queryKey: eventKeys.attendees(id),
    queryFn: () => getEventAttendees(supabase, id),
    enabled: !!id,
  });

  // Being on a live online event's screen IS listening (#120): track presence so the Live
  // tab's «{n} in ascolto» counts this member. Rows only observe; this screen is the one
  // tracking surface. subscribeEventPresence returns its cleanup → untrack on unmount.
  const isLiveNow = !!event?.is_online && !!event.live_started_at && !event.live_ended_at;
  useEffect(() => {
    if (!isLiveNow) return;
    return subscribeEventPresence(supabase, id, () => {}, { track: true });
  }, [isLiveNow, id]);

  const myRsvp = useQuery({
    queryKey: eventKeys.rsvp(id),
    queryFn: () => getMyRsvp(supabase, id, uid as string),
    enabled: !!id && !!uid,
  });
  const going = myRsvp.data?.status === 'going';

  const toggle = useMutation({
    mutationFn: (next: boolean) => upsertRsvp(supabase, id, uid as string, next),
    onMutate: async (next) => {
      setConfirmation(null); // clear any stale confirmation as a new action begins
      setCalendarNotice(null); // …and the calendar refusal, which has no timer of its own
      await qc.cancelQueries({ queryKey: eventKeys.rsvp(id) });
      const prev = qc.getQueryData(eventKeys.rsvp(id));
      const optimistic: Rsvp = {
        id: 'optimistic',
        user_id: uid ?? '',
        event_id: id,
        status: next ? 'going' : 'cancelled',
        created_at: '',
        updated_at: '',
      };
      qc.setQueryData(eventKeys.rsvp(id), optimistic);
      return { prev };
    },
    onError: (e, _next, ctx) => {
      qc.setQueryData(eventKeys.rsvp(id), ctx?.prev);
      // The rsvps capacity trigger (#105) refuses with 'sold out' — honest copy, not a
      // generic error; onSettled's attendees invalidation then flips the bar to disabled.
      const refusedFull = (e as { message?: string } | null)?.message === 'sold out';
      setConfirmation(t(refusedFull ? 'event.soldOut' : 'event.rsvp.error', locale));
    },
    onSuccess: (_d, next) => {
      setConfirmation(next ? t('event.rsvp.toast', locale) : t('event.rsvp.cancelled', locale));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: eventKeys.rsvp(id) });
      void qc.invalidateQueries({ queryKey: eventKeys.attendees(id) });
    },
  });

  const onAddToCalendar = useCallback(async () => {
    if (!event || calendarInFlight.current) return;
    calendarInFlight.current = true;
    setCalendarPending(true);
    setConfirmation(null);
    setCalendarNotice(null);
    try {
      const res = await addEventToCalendar({
        title: event.title,
        startISO: event.starts_at,
        endISO: event.ends_at,
        location: event.is_online
          ? null
          : [event.venue, event.city].filter(Boolean).join(' · ') || null,
      });
      if (res === 'added') setConfirmation(t('event.rsvp.calendarToast', locale));
      else if (res === 'error') setConfirmation(t('event.rsvp.error', locale));
      // A refusal is SAID now (#531). It used to be silent, on the premise that the OS prompt had
      // already informed the member — true of the first tap only. iOS prompts once per app, so
      // every later request resolves denied with no dialog at all; and «Add Events Only» and an
      // Expo Go grant owned by another project both land here having shown nothing. The button
      // was a permanent no-op. `blocked` additionally means the OS will not ask again, so
      // Settings is the only route left and the bar offers it.
      else setCalendarNotice(res);
    } finally {
      calendarInFlight.current = false;
      setCalendarPending(false);
    }
  }, [event, locale]);

  const now = Date.now();
  const isPast = event ? new Date(event.ends_at ?? event.starts_at).getTime() < now : false;
  const isPaid = (event?.price_cents ?? 0) > 0;
  const isPremium = event ? event.is_kairos_day || event.is_athanor_day : false;
  const isOrganizer = !!uid && event?.organizer_id === uid;
  const count = attendees.data?.count ?? 0;

  // Paid seats are tickets, not RSVPs, and ticket rows are owner-only — the count comes
  // from the event_seats_taken definer RPC (#105). Free events keep the RSVP count.
  const seats = useQuery({
    queryKey: eventKeys.seats(id),
    queryFn: () => getEventSeatsTaken(supabase, id),
    enabled: !!id && isPaid && event?.capacity != null,
  });
  const soldOut = event?.capacity != null && (isPaid ? (seats.data ?? 0) : count) >= event.capacity;

  // Single action-bar node reused by both the premium <CircleGate> branch and the
  // non-premium branch — avoids duplicated prop sets that could drift on future edits.
  const actionBar = isPaid ? (
    <TicketBar event={event!} soldOut={soldOut} locale={locale} />
  ) : (
    <RsvpBar
      going={going}
      soldOut={soldOut}
      pending={toggle.isPending || myRsvp.isLoading}
      calendarPending={calendarPending}
      confirmation={confirmation}
      permissionNotice={
        // Literal keys on both arms, never an interpolated one: a key spelled by a template
        // literal is invisible to the i18n checker and to a grep for orphans.
        calendarNotice === 'blocked'
          ? t('event.rsvp.calendarBlocked', locale)
          : calendarNotice === 'denied'
            ? t('event.rsvp.calendarDenied', locale)
            : null
      }
      onToggle={() => toggle.mutate(!going)}
      onAddToCalendar={() => void onAddToCalendar()}
      onOpenSettings={calendarNotice === 'blocked' ? () => void Linking.openSettings() : null}
      locale={locale}
    />
  );

  return (
    <Screen>
      <ScrollView className="flex-1" contentContainerClassName="gap-5 pb-12">
        <ModalHeader title={t('event.title', locale)} backLabel={t('common.back', locale)} />

        {detailState !== 'ready' || !event ? (
          // `query.isError || !event` used to be one branch saying «Non siamo riusciti a caricare
          // l'evento», so a deep link to an event that no longer exists asked the member to retry
          // forever (#111). Same split `candidacy/[id]` needed.
          <ListState
            state={detailState}
            locale={locale}
            errorLabel={t('event.error', locale)}
            emptyLabel={t('event.notFound', locale)}
            onRetry={() => void query.refetch()}
            className="px-5 pt-16"
            loading={
              <View className="items-center pt-16">
                <ActivityIndicator color={semantic.aura} />
              </View>
            }
          />
        ) : (
          <View className="gap-5 px-5">
            <EventCover event={event} locale={locale} />

            {count > 0 ? (
              <AttendeeStack
                userIds={attendees.data?.userIds ?? []}
                count={count}
                locale={locale}
              />
            ) : null}

            <View className="gap-1">
              <SectionLabel>{t('event.organizedBy', locale)}</SectionLabel>
              <PostAuthorRow authorId={event.organizer_id} size="sm" />
            </View>

            <View className="gap-3 rounded-card border border-hair bg-raise p-5">
              <DmetaRow glyph="◷" value={dateTime(event.starts_at, locale)} />
              <DmetaRow
                glyph="◎"
                value={
                  event.is_online
                    ? t('event.whereOnline', locale, { kind: t('event.streamKind', locale) })
                    : [event.venue, event.city].filter(Boolean).join(' · ') ||
                      t('event.whereLabel', locale)
                }
              />
              {/* Attendees + read-only Aura-worth label — aura from ENGINE_WEIGHTS (rule #1/#10),
                truthful: maps 1:1 to the engine's `event_attended` award (P2.5 hint-truth).
                Attendee count is allowed (rule #3). */}
              <DmetaRow
                glyph="◇"
                value={t('event.attendees', locale, {
                  n: count,
                  aura: ENGINE_WEIGHTS.EVENT_ATTENDED,
                })}
              />
            </View>

            <Text className="text-[15px] leading-6 text-ink-2">
              {t('event.descFallback', locale)}
            </Text>

            {event.is_kairos_day || event.is_athanor_day ? (
              <View className="rounded-card border border-aura-line bg-aura-soft p-4">
                <Text className="text-[13px] text-aura">{t('event.kairos.banner', locale)}</Text>
              </View>
            ) : null}

            {event.is_online ? (
              <View className="rounded-full border border-aura-line bg-aura-soft px-5 py-3">
                <Text className="text-center text-[14px] text-aura">
                  {t('event.watchLive', locale)}
                </Text>
              </View>
            ) : null}

            {isOrganizer && isPaid ? (
              <Pressable
                className="rounded-full border border-aura-line bg-aura-soft px-5 py-3"
                onPress={() => router.push(`/event/${id}/checkin`)}
                accessibilityRole="button"
                accessibilityLabel={t('event.checkin', locale)}
              >
                <Text className="text-center text-[14px] text-aura">
                  {t('event.checkin', locale)}
                </Text>
              </Pressable>
            ) : null}

            {/* Type-aware action bar. Premium (Kairos/Athanor-Day) events gate the
              action behind Circle membership for non-members (M8 §3.4). The gate
              renders the real action bar for members, the upsell banner otherwise.
              Past events are over → no gate, just the past stub. */}
            {isPast ? (
              <View className="rounded-card border border-hair bg-surface-muted p-4">
                <Text className="text-center text-[13px] text-faint">
                  {t('event.past', locale)}
                </Text>
              </View>
            ) : isPremium ? (
              <CircleGate feature="premiumEvents" variant="banner" locale={locale}>
                {actionBar}
              </CircleGate>
            ) : (
              actionBar
            )}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
