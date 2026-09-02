import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { fundKeys, getFundAggregate } from '@athanor/api';
import { formatFundTotal, timeRemaining } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { Card } from '@/components/Card';
import { SectionLabel } from '@/components/SectionLabel';
import { dreamHeroSlot, fundCycleState } from '@/lib/fund-cycle';
import { supabase } from '@/lib/supabase';
import { useActiveEdition } from '@/hooks/use-active-edition';

/**
 * Compact dream-hero card for the Home tab (PRD 07-m7-countdown-edition §3.2, block 1).
 * Shows the days remaining to the active edition's target date, the live fund
 * total, and the contributor count. Tapping the whole card navigates to the
 * Annual screen where the per-second ticker lives.
 *
 * The slot's states live in `lib/fund-cycle.ts` (issue #224, FUND-47): a confirmed
 * no-cycle read renders the first cycle's ANNOUNCEMENT — «Il primo ciclo aprirà
 * presto», forward-looking, never €0 — while loading and a failed read collapse
 * (DESIGN §11 2026-08-12 rule b: the fund heartbeat is not a claim about the
 * member; the annual screen owns the error + retry). The old «Presto qui»
 * `fallback` is gone: the fund shipped, so a milestone placeholder over it was a
 * false claim.
 *
 * Rule #3: fund total + people count are sanctioned public heartbeat — rendered
 * plainly (no glow; the glow lives on the annual screen's ticker).
 * Rule #4: flat cyan accent only (no aura glow on this card, none on the announcement).
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
      <View className="gap-3">
        <SectionLabel>{t('home.dream.title', locale)}</SectionLabel>
        <Card>
          <Text className="text-center text-[14px] leading-5 text-foreground">
            {t('fund.noCycle', locale)}
          </Text>
        </Card>
      </View>
    );
  }

  const { days } = timeRemaining(Date.parse(edition.target_at), Date.now());
  const agg = aggregateQuery.data ?? null;
  const raisedCents = agg?.raised_cents ?? 0;
  const contributors = agg?.contributor_count ?? 0;
  const fundTotal = formatFundTotal(raisedCents, locale);

  return (
    /*
      The label CARRIES the card's three numbers (#635). This Pressable is an accessibility
      element, so on iOS it is atomic: VoiceOver reads its label and never descends, and a label
      of «Dai Vita al Tuo Sogno» alone left the countdown, the total and the contributor count
      unreachable — the whole payload of the card.

      That is a deliberate DEPARTURE from the one-static-node shape `MomentiCard` and
      `FavorNudgeCard` document, and the departure has a rule: a static label is enough when it
      already says what the card says («Hai un Momento in attesa»), and is not enough when the
      card's content is DATA. Nothing here is nullable — `days`, `fundTotal` and `contributors`
      all resolve to a rendered number before this branch — so the «—»-read-aloud argument that
      keeps `MomentiCard`'s handle out of its label does not apply.
    */
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('home.dream.a11y', locale, {
        days,
        total: fundTotal,
        people: contributors,
      })}
      onPress={() => router.push('/annual')}
      className="gap-3 min-h-[56px]"
    >
      <SectionLabel>{t('home.dream.title', locale)}</SectionLabel>
      <Card>
        {/* Days remaining — big number */}
        <View className="flex-row items-baseline gap-2">
          <Text className="text-4xl font-bold text-aura">{days}</Text>
          <Text className="text-sm text-muted-foreground">{t('fund.countdown.days', locale)}</Text>
        </View>

        {/* Fund total + contributor count */}
        <View className="flex-row items-center justify-between">
          <Text className="text-base font-semibold text-foreground">{fundTotal}</Text>
          <View className="flex-row items-baseline gap-1">
            <Text className="text-sm font-medium text-foreground">{contributors}</Text>
            <Text className="text-xs text-muted-foreground">{t('fund.people.label', locale)}</Text>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}
