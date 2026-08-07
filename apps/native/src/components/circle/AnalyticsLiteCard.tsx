import { useQuery } from '@tanstack/react-query';
import { auraKeys, getAuraScoreFull } from '@athanor/api';
import { breakdownRows } from '@athanor/core';
import { t, type MessageKey } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { StatLine } from '@/components/StatLine';
import { supabase } from '@/lib/supabase';
import { fetchWeekRecap } from '@/lib/week-recap';

/**
 * Analytics lite card for Circle members (M8 §3.4, rule #3).
 * Shows the member's own week Aura delta + top-2 breakdown sources.
 * Read-only M6 data — engine dormant → coalesces to zero; render gracefully.
 * NO public/vanity metrics (rule #3): data is scoped to the viewer's own profile,
 * never surfaced to others. Full analytics dashboard is Fase 2.
 *
 * Uses getAuraScoreFull (breakdownSchema: contributi, eventi, collaborazioni,
 * valore, recensioni, affidabilita) + breakdownRows from @athanor/core for
 * display-normalized sorting. top-2 by raw value; honest «Presto qui» when empty.
 *
 * Supabase client: module-level `supabase` singleton (annual.tsx pattern).
 */
export function AnalyticsLiteCard({ profileId, locale }: { profileId: string; locale: Locale }) {
  const query = useQuery({
    queryKey: auraKeys.detail(profileId),
    queryFn: () => getAuraScoreFull(supabase, profileId),
    enabled: !!profileId,
    staleTime: 60_000,
  });

  // Real 7-day delta (P3.7): shared fetch shape with Home's WeekCard (same key).
  const recapQuery = useQuery({
    queryKey: auraKeys.recap(profileId),
    queryFn: () => fetchWeekRecap(profileId),
    enabled: !!profileId,
    staleTime: 60_000,
  });

  const full = query.data;
  const recap = recapQuery.data;

  // Top-2 breakdown sources by raw value (engine dormant → all zero → empty list)
  const top2 =
    full && full.score > 0
      ? breakdownRows(full.breakdown)
          .filter((r) => r.value > 0)
          .sort((a, b) => b.value - a.value)
          .slice(0, 2)
      : [];

  return (
    <View className="rounded-card border border-hair bg-raise p-5 gap-4">
      {/* Header */}
      <View className="gap-1">
        <Text className="text-[15px] font-semibold text-foreground">
          {t('circle.analytics.title', locale)}
        </Text>
        <Text className="text-[12px] text-muted-foreground">
          {t('circle.analytics.sub', locale)}
        </Text>
      </View>

      {/* Week Aura delta stat — real 7-day sum from the ledger, not lifetime score */}
      <StatLine
        items={[
          {
            value: recap ? `+${recap.auraWeek}` : '—',
            label: t('circle.analytics.weekDelta', locale),
          },
        ]}
      />

      {/* Top-2 breakdown sources */}
      {top2.length > 0 ? (
        <View className="gap-2">
          <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
            {t('circle.analytics.topSources', locale)}
          </Text>
          {top2.map((row) => (
            <View key={row.key} className="flex-row items-center justify-between">
              <Text className="text-[14px] text-foreground">
                {t(`aura.source.${row.key}` as MessageKey, locale)}
              </Text>
              <Text className="text-[14px] font-semibold text-aura">{row.value}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text className="text-[13px] text-muted-foreground">
          {t('circle.analytics.empty', locale)}
        </Text>
      )}
    </View>
  );
}
