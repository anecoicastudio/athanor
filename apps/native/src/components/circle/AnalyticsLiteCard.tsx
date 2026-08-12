import { useQuery } from '@tanstack/react-query';
import { auraKeys, getAuraScoreFull } from '@athanor/api';
import { breakdownRows } from '@athanor/core';
import { t, type MessageKey } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { ListState } from '@/components/ListState';
import { SectionLabel } from '@/components/SectionLabel';
import { StatLine } from '@/components/StatLine';
import { listState } from '@/lib/list-state';
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
 * display-normalized sorting. top-2 by raw value; «Presto qui» ONLY when the read
 * came back empty — a failed read gets its own arm and a retry (#111).
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

  // «Presto qui» is a claim that the feature is not built yet, and it used to cover a failed
  // read as well as a genuinely quiet ledger (#111) — so a paying member whose request failed
  // was told the analytics they are paying for do not exist. The week-delta stat above never
  // had this bug: it degrades to «—», which is the pattern #100 cites as the right one.
  const sourcesState = listState({
    status: query.status,
    fetchStatus: query.fetchStatus,
    isEmpty: top2.length === 0,
  });

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
      {sourcesState === 'ready' ? (
        <View className="gap-2">
          <SectionLabel>{t('circle.analytics.topSources', locale)}</SectionLabel>
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
        <ListState
          state={sourcesState}
          locale={locale}
          errorLabel={t('aura.error', locale)}
          emptyLabel={t('circle.analytics.empty', locale)}
          onRetry={() => void query.refetch()}
          className="py-1"
        />
      )}
    </View>
  );
}
