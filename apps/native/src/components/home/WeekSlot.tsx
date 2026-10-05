import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { auraKeys } from '@athanor/api';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View, cn } from '@/tw';
import { WeekCard } from '@/components/aura/WeekCard';
import { SectionLabel } from '@/components/SectionLabel';
import { ShimmerBar } from '@/components/ShimmerBar';
import { useAuth } from '@/lib/auth-context';
import { listState } from '@/lib/list-state';
import { PRESS_DIM } from '@/lib/press';
import { fetchWeekRecap } from '@/lib/week-recap';
import { weekRecapIsEmpty } from '@/lib/week-slot';

/**
 * Home block «La tua settimana» — the week recap, in the four states it actually has (#100).
 *
 * It used to have one non-data branch. Loading, idle, a failed read and a genuinely quiet week
 * all rendered `ComingSoonSection` — «Presto qui» — over a feature that shipped in M6 and that
 * `(modal)/recap.tsx` renders in full three taps away. A failed read was pixel-identical to a
 * quiet week, so nobody could ever report it, and on a product whose premise is *earned*
 * reputation the message landed exactly wrong: a member who had a quiet week was told the
 * scoreboard did not exist rather than that they had not lit it yet.
 *
 * `(modal)/recap.tsx` already held the correct four-state shape for the same query; this
 * is that shape moved into the slot. It has since been lifted, as that note anticipated: the
 * branch rule is `listState` (`lib/list-state.ts`, #111); the arms were the `ListState`
 * component until 2026-10-05 (see «NO CARD» below).
 * `weekSlotState` is gone; `weekRecapIsEmpty` survives it as the `isEmpty` argument, because
 * what counts as a quiet week was never a question about queries.
 *
 * `staleWins: false` is this slot's half of that shared rule. `MomentiCard`'s error note decides
 * the OPPOSITE for the deck and states the line: a stale Aura number is a claim about a
 * person's worth, a stale proposal costs one wasted tap. This is the first kind — the query
 * client persists to AsyncStorage with a 24h `gcTime` and Aura decays, so a stale week
 * presented as this week is the false confidence `aura-display.ts` refused for the score.
 *
 * NO CARD, in any of the four states (#921, 2026-10-05): Home's one bordered card is the
 * waiting Momento. The data state is `WeekCard`, bare; the other three are the same grey
 * label over one grey line, standing on the stage. They are written here and not through the
 * `ListState` component, whose error and empty arms draw `EmptyState`'s outline mandorla and
 * a centred title: that is a whole screen's empty state, and inside a Home slot it stood as
 * tall as the Momento card. The branch rule is still `listState`. The prototype draws the
 * data state only.
 *
 * NO `staleTime` — same key, same queryFn, no options, the discipline `MomentiCard`
 * documents. `AnalyticsLiteCard`'s `recapQuery` already sets `staleTime: 60_000` on
 * `auraKeys.recap` while this screen and the sheet set none; that divergence predates this change
 * and belongs with
 * #111. Adding a fourth setting on one key would only deepen it.
 *
 * The retry is a link, hand-rolled with the `ghost` link's classes because it stands on the
 * gutter (`Button ghost` centres its words): a failed fetch should not be the loudest block on
 * the home screen.
 *
 * Rule #1 is untouched: this reads the ledger and never writes it.
 */
export function WeekSlot({ locale }: { locale: Locale }) {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  // Shared queryFn (`lib/week-recap`) — same key as AnalyticsLiteCard and the recap sheet.
  const recapQuery = useQuery({
    queryKey: auraKeys.recap(userId),
    queryFn: () => fetchWeekRecap(userId),
    enabled: !!userId,
  });

  const recap = recapQuery.data;
  const queryState = listState({
    status: recapQuery.status,
    fetchStatus: recapQuery.fetchStatus,
    // A settled query with no recap has no week to describe, so it must not reach
    // `weekRecapIsEmpty` and assert a quiet week on the strength of nothing.
    isEmpty: recap == null || weekRecapIsEmpty(recap),
    staleWins: false,
  });

  // `enabled: !!userId` holds this query while the session hydrates, which `listState` reports
  // as 'idle' and a list renders as nothing — right for a list, wrong here, because the
  // section label is already on screen and would sit over nothing. `weekSlotState` folded
  // idle into 'pending' for exactly this reason; the fold keeps the behaviour and makes the
  // choice visible instead of baking it into the predicate for every caller.
  const state = queryState === 'idle' ? 'loading' : queryState;

  // `state === 'ready'` already implies `recap != null`, but that is a fact about `listState`
  // and not one the compiler can see through a string return. The guard is for tsc, not for us.
  if (state === 'ready' && recap) {
    return <WeekCard recap={recap} locale={locale} onPress={() => router.push('/recap')} />;
  }

  return (
    <View className="gap-2">
      <SectionLabel>{t('home.week.title', locale)}</SectionLabel>
      {state === 'loading' ? (
        // Two `ShimmerBar`s (`hair`, static, so reduced-motion safe). `feed/FeedSkeleton.tsx`
        // is not reusable here: no props, three hardcoded blocks, and it bakes a `px-5` that
        // would double inside Home's own `px-5` ScrollView.
        <View className="gap-2">
          <ShimmerBar />
          <ShimmerBar width="w-2/3" />
        </View>
      ) : state === 'error' ? (
        <View className="items-start">
          <Text className="type-small text-muted-foreground">{t('aura.error', locale)}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void recapQuery.refetch()}
            className={cn('min-h-[44px] justify-center', PRESS_DIM)}
          >
            <Text className="type-small text-foreground underline">
              {t('common.retry', locale)}
            </Text>
          </Pressable>
        </View>
      ) : (
        // A real quiet week. Same sentence the sheet says about the same seven days
        // (`recap.tsx`'s `recap.emptyWeek`) — one week, one claim, and no new key for copy that
        // exists.
        <Text className="type-small text-muted-foreground">{t('recap.emptyWeek', locale)}</Text>
      )}
    </View>
  );
}
