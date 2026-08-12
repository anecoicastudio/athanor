import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { eventKeys, getEventsCalendar } from '@athanor/api';
import { type Locale, t } from '@athanor/i18n';
import { Pressable, Text, View } from '@/tw';
import { HIT_SLOP } from '@/lib/a11y';
import { EventRow } from '@/components/live/EventRow';
import { SectionLabel } from '@/components/SectionLabel';
import { listState } from '@/lib/list-state';
import { supabase } from '@/lib/supabase';

const LIVE_HREF = '/(modal)/live' as const;

/**
 * Home «Oggi» — the next upcoming events + an entry into Athanor Live (M4 fill of the M1 stub).
 *
 * The block had ONE non-data branch and three situations fell into it: still loading, the read
 * threw, and there genuinely are no events (#111). All three rendered «Nessun evento in
 * programma», and only the third was ever true.
 *
 * THE SLOT COLLAPSES rather than naming the three, and that is the deliberate half of #111's
 * sort — the same call `FavorNudgeCard.tsx:19-30` and `MomentiCard.tsx:20-27` already made on
 * the blocks either side of it. The rule: a false «you have nothing» is a claim about the
 * member and has to be named; an ABSENT block asserts nothing. Nobody is misinformed by a Home
 * preview that is not there, and `(modal)/live` owns the copy and the retry for whoever goes
 * looking. #177 settled that a short honest Home beats a full one made of promises.
 *
 * Collapsing swallows a failed read too, which is the considered trade, not the defect. The
 * block that must NOT collapse is `WeekSlot` beside it: that one reports the member's own Aura,
 * where silence and a wrong number are both claims about their worth.
 *
 * The whole `View` goes, eyebrow and «vedi Athanor Live ›» included — a header over nothing is
 * the untitled-header defect #119 catalogues, and this is why the collapse is a `return null`
 * here rather than a mode on `ListState`: a child cannot unmount its parent.
 */
export function TodaySection({ locale }: { locale: Locale }) {
  const router = useRouter();
  const query = useQuery({
    queryKey: eventKeys.today(),
    queryFn: () => getEventsCalendar(supabase, null, 3),
  });
  const events = query.data?.events ?? [];

  // `staleWins`: three event rows an hour old are still three real events, and the member is
  // one tap from the surface that re-reads them. Nothing here is a claim about a person.
  const state = listState({
    status: query.status,
    fetchStatus: query.fetchStatus,
    isEmpty: events.length === 0,
    staleWins: true,
  });

  if (state !== 'ready') return null;

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <SectionLabel>{t('home.today.title', locale)}</SectionLabel>
        <Pressable
          onPress={() => router.push(LIVE_HREF)}
          hitSlop={HIT_SLOP}
          accessibilityRole="link"
        >
          <Text className="text-[13px] text-aura">{t('home.today.seeLive', locale)}</Text>
        </Pressable>
      </View>
      <View className="gap-3">
        {events.map((e) => (
          <EventRow
            key={e.id}
            data={{
              id: e.id,
              title: e.title,
              category: e.category,
              starts_at: e.starts_at,
              venue: e.venue,
              city: e.city,
              is_online: e.is_online,
              is_athanor_day: e.is_athanor_day,
            }}
            locale={locale}
            onPress={() => router.push(`/(modal)/event/${e.id}`)}
          />
        ))}
      </View>
    </View>
  );
}
