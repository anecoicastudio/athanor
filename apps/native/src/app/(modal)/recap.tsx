import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { auraKeys, getStars, starKeys } from '@athanor/api';
import { pickNextStar } from '@athanor/core';
import { t, type MessageKey } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { AuraSourceRow } from '@/components/aura/AuraSourceRow';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { fetchWeekRecap } from '@/lib/week-recap';
import { MODAL_A11Y } from '@/lib/a11y';

/** Shimmer placeholder bar — muted rect for loading state */
function ShimmerBar({ width = 'w-full' }: { width?: string }) {
  return <View className={`h-5 rounded-sm bg-raise ${width}`} />;
}

/**
 * Week recap sheet (M6 §3.4).
 * Derives display aggregation from owner's ledger via core summarizeWeek (rule #1: no score write).
 * Engine is DORMANT → getAuraEventsSince returns [] → recap all-zeros → empty-week state.
 */
export default function RecapScreen() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const locale: Locale = profile?.locale ?? 'it';
  const me = session?.user.id ?? '';

  // Week recap: shared queryFn (lib/week-recap) — one fetch shape per auraKeys.recap key.
  const recapQuery = useQuery({
    queryKey: auraKeys.recap(me),
    queryFn: () => fetchWeekRecap(me),
    enabled: !!me,
  });

  // Stars: for «Prossima stella» block via pickNextStar.
  const starsQuery = useQuery({
    queryKey: starKeys.list(me),
    queryFn: () => getStars(supabase, me),
    enabled: !!me,
  });

  const recap = recapQuery.data;
  const stars = starsQuery.data ?? [];
  const nextStar = pickNextStar(stars);

  const isLoading = recapQuery.isLoading;
  const isError = recapQuery.isError;
  const isEmptyWeek = recap != null && recap.auraWeek === 0 && recap.contributi === 0;

  // «Prossima stella» {gap}: localized via recap.next.gap to avoid Italian "a" leaking into EN.
  const gapStr = (() => {
    if (!nextStar) return '';
    const remaining = nextStar.total - nextStar.done;
    const unit = t(`star.unit.${nextStar.unit}` as MessageKey, locale);
    return t('recap.next.gap' as MessageKey, locale, { remaining, unit });
  })();

  const starName = nextStar ? t(`star.${nextStar.starId}` as MessageKey, locale) : '';

  return (
    <View {...MODAL_A11Y} className="flex-1 bg-background">
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pb-3 pt-14">
        <Text accessibilityRole="header" className="text-[17px] font-semibold text-foreground">
          {t('recap.title' as MessageKey, locale)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back' as MessageKey, locale)}
          hitSlop={8}
          onPress={() => router.back()}
        >
          <Text className="text-[17px] text-muted-foreground">✕</Text>
        </Pressable>
      </View>

      {/* Sub */}
      <Text className="px-5 pb-4 text-[13px] text-muted-foreground">
        {t('recap.sub' as MessageKey, locale)}
      </Text>

      <ScrollView contentContainerClassName="px-5 pb-12">
        {/* Error state */}
        {isError ? (
          <View className="items-center gap-4 py-8">
            <EmptyState>{t('aura.error' as MessageKey, locale)}</EmptyState>
            <Button
              label={t('common.retry' as MessageKey, locale)}
              variant="ghost"
              onPress={() => void recapQuery.refetch()}
            />
          </View>
        ) : null}

        {/* Metric rows */}
        {!isError ? (
          <View className="gap-1">
            {isLoading ? (
              <View className="gap-3 py-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <ShimmerBar key={i} />
                ))}
              </View>
            ) : isEmptyWeek ? (
              <View className="mt-4">
                <EmptyState>{t('recap.emptyWeek' as MessageKey, locale)}</EmptyState>
              </View>
            ) : (
              <View className="gap-1 py-2">
                <AuraSourceRow
                  label={t('recap.metric.aura' as MessageKey, locale)}
                  value={recap?.auraWeek ?? 0}
                  width={0}
                  showBar={false}
                />
                <AuraSourceRow
                  label={t('recap.metric.contributi' as MessageKey, locale)}
                  value={recap?.contributi ?? 0}
                  width={0}
                  showBar={false}
                />
                <AuraSourceRow
                  label={t('recap.metric.dreams' as MessageKey, locale)}
                  value={recap?.sogniAiutati ?? 0}
                  width={0}
                  showBar={false}
                />
                <AuraSourceRow
                  label={t('recap.metric.hours' as MessageKey, locale)}
                  value={recap?.oreDonate ?? 0}
                  width={0}
                  showBar={false}
                />
              </View>
            )}
          </View>
        ) : null}

        {/* «Prossima stella» feature block — hide when nextStar is null */}
        {!isLoading && !isError && nextStar != null ? (
          <View className="mt-6">
            <Card>
              <SectionLabel tone="aura">
                {t('recap.next.label' as MessageKey, locale)}
              </SectionLabel>
              <Text className="text-[15px] font-semibold text-foreground">
                {t('recap.next.title' as MessageKey, locale, { star: starName, gap: gapStr })}
              </Text>
              <Text className="text-[13px] text-muted-foreground">
                {t('recap.next.body' as MessageKey, locale)}
              </Text>
            </Card>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
