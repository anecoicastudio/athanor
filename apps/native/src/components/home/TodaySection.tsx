import { useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { eventKeys, getEventsCalendar } from '@athanor/api';
import { type Locale, t } from '@athanor/i18n';
import { Pressable, Text, View, cn } from '@/tw';
import { EventRow, toRowData } from '@/components/live/EventRow';
import { useEntitlement } from '@/hooks/use-entitlement';
import { SectionLabel } from '@/components/SectionLabel';
import { listState } from '@/lib/list-state';
import { PRESS_DIM } from '@/lib/press';
import { stacksTrailing } from '@/lib/type-scale';
import { supabase } from '@/lib/supabase';

const LIVE_HREF = '/(modal)/live' as const;

/**
 * Home «Oggi» — the next events + an entry into Athanor Live (M4 fill of the M1 stub).
 *
 * Rows go through `toRowData` like every other `getEventsCalendar` consumer. This block used
 * to hand-build the row shape and omit `live`, which was harmless only because #530's old
 * `starts_at >= now` bound meant no started event could reach it. Now one can — and it sorts
 * FIRST — so a hand-built row would show an event that is live right now as an ordinary
 * future row with a start time already in the past. `toRowData` also derives `premiumLocked`,
 * which the hand-built shape was likewise missing.
 *
 * `limit 3` is unchanged, so a live event now takes a slot an upcoming one used to hold. That
 * is the intent: what is happening now outranks what is happening later.
 *
 * The block had ONE non-data branch and three situations fell into it: still loading, the read
 * threw, and there genuinely are no events (#111). All three rendered «Nessun evento in
 * programma», and only the third was ever true.
 *
 * THE SLOT COLLAPSES rather than naming the three, and that is the deliberate half of #111's
 * sort — the same call `FavorNudgeCard`'s «NO PLACEHOLDER» note and `MomentiCard`'s «NO `fallback`
 * PROP» note already made on the blocks either side of it. The rule: a false «you have nothing» is
 * a claim about the member and has to be named; an ABSENT block asserts nothing. Nobody is
 * misinformed by a Home preview that is not there, and `(modal)/live` owns the copy and the retry
 * for whoever goes looking. #177 settled that a short honest Home beats a full one made of
 * promises.
 *
 * Collapsing swallows a failed read too, which is the considered trade, not the defect. The
 * block that must NOT collapse is `WeekSlot` beside it: that one reports the member's own Aura,
 * where silence and a wrong number are both claims about their worth.
 *
 * The whole `View` goes, label and «Athanor Live ›» included — a header over nothing is
 * the untitled-header defect #119 catalogues, and this is why the collapse is a `return null`
 * here rather than a mode on `ListState`: a child cannot unmount its parent.
 *
 * Galleria (#921, 2026-10-05) converts the label row only: the gap under it is 8 and the link
 * is an underlined foreground link, not cyan. The rows are still `live/EventRow`'s bordered
 * cards, where the prototype draws one group of rows: that component has ten callers and
 * converts with Athanor Live (Marco, 2026-10-05).
 */
export function TodaySection({ locale }: { locale: Locale }) {
  const router = useRouter();
  const query = useQuery({
    queryKey: eventKeys.today(),
    queryFn: () => getEventsCalendar(supabase, null, 3),
  });
  const events = query.data?.events ?? [];
  const { data: entitlement } = useEntitlement();
  const premiumEnabled = entitlement?.features.premiumEvents ?? false;
  const stacked = stacksTrailing(useWindowDimensions().fontScale);

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
    <View className="gap-2">
      {/* Beside each other, or stacked at the accessibility text sizes (`stacksTrailing`).
          Beside, the label takes the width that is left (`flex-1`): sized to its own text, the
          moto g17 broke «Your week» over two lines in a box exactly as wide as the words
          (Android 15, dev client, font scale 1.0, 2026-10-05). */}
      <View className={stacked ? 'items-start' : 'flex-row items-center justify-between gap-3'}>
        <SectionLabel className={stacked ? undefined : 'flex-1'}>
          {t('home.upcoming.title', locale)}
        </SectionLabel>
        <Pressable
          onPress={() => router.push(LIVE_HREF)}
          accessibilityRole="link"
          // The line box of a 15px label is under the 44pt floor of §10, and a `hitSlop` sized
          // for a 22pt icon does not close the gap for bare small text: the box is the target.
          className={cn('min-h-[44px] justify-center', PRESS_DIM)}
        >
          <Text className="type-small text-foreground underline">
            {t('home.upcoming.seeLive', locale)}
          </Text>
        </Pressable>
      </View>
      <View className="gap-3">
        {events.map((e) => (
          <EventRow
            key={e.id}
            data={toRowData(e, premiumEnabled)}
            locale={locale}
            onPress={() => router.push(`/(modal)/event/${e.id}`)}
          />
        ))}
      </View>
    </View>
  );
}
