import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { fundKeys, getActiveEdition, getFundAggregate } from '@athanor/api';
import { formatFundTotal, timeRemaining } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { Card } from '@/components/Card';
import { SectionLabel } from '@/components/SectionLabel';
import { supabase } from '@/lib/supabase';

/**
 * Compact dream-hero card for the Home tab (PRD 07-m7-countdown-edition §3.2, block 1).
 * Shows the days remaining to the active edition's target date, the live fund
 * total, and the contributor count. Tapping the whole card navigates to the
 * Annual screen where the per-second ticker lives.
 *
 * When no active edition exists the `fallback` node is rendered instead so
 * exactly one element occupies the slot (never an empty gap).
 *
 * Rule #3: fund total + people count are sanctioned public heartbeat — rendered
 * plainly (no glow; the glow lives on the annual screen's ticker).
 * Rule #4: flat cyan accent only (no aura glow on this card).
 */
export function DreamHeroCard({ locale, fallback }: { locale: Locale; fallback?: ReactNode }) {
  const router = useRouter();

  const editionQuery = useQuery({
    queryKey: fundKeys.activeEdition(),
    queryFn: () => getActiveEdition(supabase),
    refetchInterval: 60_000,
  });

  const edition = editionQuery.data ?? null;

  const aggregateQuery = useQuery({
    queryKey: fundKeys.aggregate(edition?.id ?? ''),
    queryFn: () => getFundAggregate(supabase, edition!.id),
    enabled: !!edition,
    refetchInterval: 60_000,
  });

  // No active edition → render the fallback (caller's ComingSoonSection placeholder).
  if (!edition) return fallback ?? null;

  const { days } = timeRemaining(Date.parse(edition.target_at), Date.now());
  const agg = aggregateQuery.data ?? null;
  const raisedCents = agg?.raised_cents ?? 0;
  const contributors = agg?.contributor_count ?? 0;
  const fundTotal = formatFundTotal(raisedCents, locale);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('home.dream.title', locale)}
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
