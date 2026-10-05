import { useWindowDimensions } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { fundKeys, getFundAggregate } from '@athanor/api';
import { formatFundTotal, timeRemaining } from '@athanor/core';
import { t, tn } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View, cn } from '@/tw';
import { SectionLabel } from '@/components/SectionLabel';
import { dreamHeroSlot, fundCycleState } from '@/lib/fund-cycle';
import { PRESS_DIM } from '@/lib/press';
import { stacksTrailing } from '@/lib/type-scale';
import { supabase } from '@/lib/supabase';
import { useNow } from '@/hooks/use-now';
import { useActiveEdition } from '@/hooks/use-active-edition';

/**
 * Compact dream-hero block for the Home tab (PRD 07-m7-countdown-edition §3.2, block 1).
 * Shows the days remaining to the active edition's target date, the live fund
 * total, and the contributor count. Tapping the whole block navigates to the
 * Annual screen where the per-second ticker lives.
 *
 * It is not a card (#921, 2026-10-05): Home's one bordered card is the waiting Momento, and
 * the prototype draws this block bare on the stage — the label, the days as a 44/800 numeral
 * with its word, and at the right «total · N persone ›» in grey. The file keeps its name.
 *
 * The slot's states live in `lib/fund-cycle.ts` (issue #224, FUND-47): a confirmed
 * no-cycle read renders the first cycle's ANNOUNCEMENT — «Il primo ciclo aprirà
 * presto», forward-looking, never €0 — while loading and a failed read collapse
 * (DESIGN §11 2026-08-12 rule b: the fund heartbeat is not a claim about the
 * member; the annual screen owns the error + retry). The old «Presto qui»
 * `fallback` is gone: the fund shipped, so a milestone placeholder over it was a
 * false claim.
 *
 * Rule #3: fund total + people count are sanctioned public heartbeat — rendered plainly.
 * Rule #4: no cyan here. The countdown's cyan mark is its SECONDS (DESIGN §2.3), and this
 * block counts days, so the numeral is foreground (Marco, 2026-10-05).
 */
export function DreamHeroCard({ locale }: { locale: Locale }) {
  const router = useRouter();

  const editionQuery = useActiveEdition({ refetchInterval: 60_000 });

  const edition = editionQuery.data ?? null;

  const aggregateQuery = useQuery({
    queryKey: fundKeys.aggregate(edition?.id ?? ''),
    queryFn: () => getFundAggregate(supabase, edition!.id),
    enabled: !!edition,
    refetchInterval: 60_000,
  });

  // Above the early returns: a hook below them would run in a different order on the
  // render where the cycle appears.
  const now = useNow(60_000);
  const stacked = stacksTrailing(useWindowDimensions().fontScale);

  const slot = dreamHeroSlot(
    fundCycleState({
      status: editionQuery.status,
      fetchStatus: editionQuery.fetchStatus,
      edition,
    }),
  );

  if (slot === 'collapse') return null;

  if (slot === 'announce' || !edition) {
    return (
      <View className="gap-2">
        <SectionLabel>{t('home.dream.title', locale)}</SectionLabel>
        <Text className="type-body text-foreground">{t('fund.noCycle', locale)}</Text>
      </View>
    );
  }

  const { days } = timeRemaining(Date.parse(edition.target_at), now);
  const agg = aggregateQuery.data ?? null;
  const raisedCents = agg?.raised_cents ?? 0;
  const contributors = agg?.contributor_count ?? 0;
  const fundTotal = formatFundTotal(raisedCents, locale);

  return (
    /*
      The label CARRIES the block's three numbers (#635). This Pressable is an accessibility
      element, so on iOS it is atomic: VoiceOver reads its label and never descends, and a label
      of «Dai Vita al Tuo Sogno» alone left the countdown, the total and the contributor count
      unreachable — the whole payload of the block.

      That is a deliberate DEPARTURE from the one-static-node shape `FavorNudgeCard`
      documents, and the departure has a rule: a static label is enough when it already says
      what the block says («Qualcuno ha bisogno di una mano»), and is not enough when the
      block's content is DATA. Nothing here is nullable — `days`, `fundTotal` and `contributors`
      all resolve to a rendered number before this branch — so the «—»-read-aloud argument that
      keeps a handle out of `FavorNudgeCard`'s label does not apply.
    */
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('home.dream.a11y', locale, {
        // `tn`, not `t`: a countdown reaches 1 on the last day of every cycle by construction,
        // and «mancano 1 giorni» is the bug `t.ts`'s plural pattern (#634) exists to prevent.
        // Two countables and `tn` takes one `n`, so each clause is its own key rather than a
        // branch at this call site — which is the half of that pattern that matters.
        days: tn('home.dream.a11y.days', days, locale),
        total: fundTotal,
        people: tn('home.dream.a11y.people', contributors, locale),
      })}
      onPress={() => router.push('/annual')}
      // At the accessibility text sizes (`stacksTrailing`) the grey line goes under the numeral.
      // Beside it, the line takes the width that is left (`flex-1`) and is not sized to its
      // own text: sized to fit inside a wrapping row, the moto g17 drew «€ 9,852 · 7» and
      // lost «people ›» (Android 15, dev client, font scale 1.0, 2026-10-05).
      className={cn(
        stacked ? 'gap-2' : 'min-h-[56px] flex-row items-end justify-between gap-3',
        PRESS_DIM,
      )}
    >
      <View className={stacked ? 'gap-2' : 'shrink-0 gap-2'}>
        <SectionLabel>{t('home.dream.title', locale)}</SectionLabel>
        {/* `flex-wrap` (#639): the numeral and its word sit on one baseline row with no
            shrink, so at AX sizes the word left the screen; wrapping drops it to a second
            line instead. The word is a `Text` of its own: `type-num` is for digits. */}
        <View className="flex-row flex-wrap items-baseline gap-[10px]">
          <Text className="type-num text-foreground">{days}</Text>
          <Text className="type-small text-muted-foreground">
            {tn('fund.countdown.days', days, locale)}
          </Text>
        </View>
      </View>
      {/* Fund total + contributor count. `tn`: one contributor is «1 persona». */}
      <Text className={cn('type-small text-muted-foreground', !stacked && 'flex-1 text-right')}>
        {fundTotal} · {tn('home.dream.a11y.people', contributors, locale)} ›
      </Text>
    </Pressable>
  );
}
