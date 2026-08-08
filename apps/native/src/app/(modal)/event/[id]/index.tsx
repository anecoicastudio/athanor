import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { eventKeys, getEvent, getEventAttendees, getMyRsvp, upsertRsvp } from '@athanor/api';
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
import { EmptyState } from '@/components/EmptyState';
import { PostAuthorRow } from '@/components/feed/PostAuthorRow';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { addEventToCalendar } from '@/lib/calendar';

function formatWhen(iso: string, locale: 'it' | 'en'): string {
  const d = new Date(iso);
  return d.toLocaleString(locale === 'it' ? 'it-IT' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const locale = profile?.locale ?? 'it';
  const uid = profile?.id ?? null;
  const [confirmation, setConfirmation] = useState<string | null>(null);
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

  const attendees = useQuery({
    queryKey: eventKeys.attendees(id),
    queryFn: () => getEventAttendees(supabase, id),
    enabled: !!id,
  });

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
    onError: (_e, _next, ctx) => {
      qc.setQueryData(eventKeys.rsvp(id), ctx?.prev);
      setConfirmation(t('event.rsvp.error', locale));
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
    if (!event) return;
    setConfirmation(null);
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
    // 'denied' → silent: the OS permission prompt already informed the user.
  }, [event, locale]);

  const now = Date.now();
  const isPast = event ? new Date(event.ends_at ?? event.starts_at).getTime() < now : false;
  const isPaid = (event?.price_cents ?? 0) > 0;
  const isPremium = event ? event.is_kairos_day || event.is_athanor_day : false;
  const isOrganizer = !!uid && event?.organizer_id === uid;
  const count = attendees.data?.count ?? 0;
  const soldOut = event?.capacity != null && count >= event.capacity;

  // Single action-bar node reused by both the premium <CircleGate> branch and the
  // non-premium branch — avoids duplicated prop sets that could drift on future edits.
  const actionBar = isPaid ? (
    <TicketBar event={event!} locale={locale} />
  ) : (
    <RsvpBar
      going={going}
      soldOut={soldOut}
      pending={toggle.isPending || myRsvp.isLoading}
      confirmation={confirmation}
      onToggle={() => toggle.mutate(!going)}
      onAddToCalendar={() => void onAddToCalendar()}
      locale={locale}
    />
  );

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 pb-12">
      <ModalHeader title={t('event.title', locale)} backLabel={t('common.back', locale)} />

      {query.isLoading ? (
        <View className="items-center pt-16">
          <ActivityIndicator color={semantic.aura} />
        </View>
      ) : query.isError || !event ? (
        <View className="items-center gap-4 px-5 pt-16">
          <EmptyState>{t('event.error', locale)}</EmptyState>
          <Pressable
            className="rounded-ctl border border-aura-line bg-aura-soft px-5 py-2"
            onPress={() => void query.refetch()}
          >
            <Text className="text-[13px] text-aura">{t('common.retry', locale)}</Text>
          </Pressable>
        </View>
      ) : (
        <View className="gap-5 px-5">
          <EventCover event={event} locale={locale} />

          {count > 0 ? (
            <AttendeeStack userIds={attendees.data?.userIds ?? []} count={count} locale={locale} />
          ) : null}

          <View className="gap-1">
            <SectionLabel>
              {t('event.organizedBy', locale)}
            </SectionLabel>
            <PostAuthorRow authorId={event.organizer_id} size="sm" />
          </View>

          <View className="gap-3 rounded-card border border-hair bg-raise p-5">
            <DmetaRow glyph="◷" value={formatWhen(event.starts_at, locale)} />
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
              value={t('event.attendees', locale, { n: count, aura: ENGINE_WEIGHTS.EVENT_ATTENDED })}
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
              <Text className="text-center text-[13px] text-faint">{t('event.past', locale)}</Text>
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
  );
}
