import { useQuery } from '@tanstack/react-query';
import { type Href, useRouter } from 'expo-router';
import { ScrollView } from 'react-native';
import { auraKeys, getAuraScoreFull } from '@athanor/api';
import { auraGlowLevel, breakdownRows } from '@athanor/core';
import { t, type MessageKey } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { AuraSourceRow } from '@/components/aura/AuraSourceRow';
import { RuleRow } from '@/components/aura/RuleRow';
import { AuraValue } from '@/components/AuraValue';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Mandorla } from '@/components/Mandorla';
import { ModalHeader } from '@/components/ModalHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { useAuth } from '@/lib/auth-context';
import { useAuraRealtime } from '@/lib/aura-realtime';
import { supabase } from '@/lib/supabase';

const IDLE_THRESHOLD_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Shimmer placeholder bar — muted rect for loading state */
function ShimmerBar({ width = 'w-full' }: { width?: string }) {
  return <View className={`h-5 rounded-sm bg-raise ${width}`} />;
}

/**
 * Aura breakdown modal (M6 §3.1).
 * Shows hero score + 6 bucket bars + 3 protection rules + decay caption + ledger CTA.
 * Read-only. No Aura writes (rule #1). Cache key: auraKeys.detail (not .score) —
 * different return shape from the snapshot used on Profilo/Home.
 */
export default function AuraScreen() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const locale: Locale = profile?.locale ?? 'it';
  const me = session?.user.id ?? '';

  // Realtime wiring: when score pushes arrive, auraKeys.all is invalidated so
  // the hero AuraValue re-tweens on the refetched value (§3.1 realtime-bump).
  // No callback needed — just score + ledger + stars cache invalidation.
  useAuraRealtime(me);

  const query = useQuery({
    queryKey: auraKeys.detail(me),
    queryFn: () => getAuraScoreFull(supabase, me),
    enabled: !!me,
  });

  const full = query.data;
  const score = full?.score ?? 0;
  const glowLevel = auraGlowLevel(score);

  // Decay caption: show only when idle > 30 days from lastQualifyingActionAt
  let idleDays: number | null = null;
  if (full?.lastQualifyingActionAt) {
    const last = new Date(full.lastQualifyingActionAt).getTime();
    const elapsed = Math.floor((Date.now() - last) / MS_PER_DAY);
    if (elapsed > IDLE_THRESHOLD_DAYS) idleDays = elapsed;
  }

  return (
    <View className="flex-1 bg-background">
      {/* Header */}
      <ModalHeader title={t('aura.title', locale)} backLabel={t('common.back', locale)} />

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }}>
        {/* Hero */}
        <View className="items-center gap-3 py-8">
          <Mandorla size={96} glowLevel={glowLevel}>
            {null}
          </Mandorla>
          {query.isLoading ? (
            <Text
              className="text-aura font-extrabold"
              style={{ fontSize: 56, fontVariant: ['tabular-nums'] }}
            >
              --
            </Text>
          ) : (
            <AuraValue value={score} size={56} flashOnIncrease />
          )}
          <Text className="text-[13px] text-muted-foreground">{t('aura.tagline', locale)}</Text>
        </View>

        {/* Error state */}
        {query.isError ? (
          <View className="items-center gap-4 py-8">
            <EmptyState>{t('aura.error', locale)}</EmptyState>
            <Button
              label={t('common.retry', locale)}
              variant="ghost"
              onPress={() => void query.refetch()}
            />
          </View>
        ) : null}

        {/* Sources section */}
        {!query.isError ? (
          <View className="gap-3">
            <SectionLabel>{t('aura.sources.title', locale)}</SectionLabel>
            {full === undefined
              ? Array.from({ length: 6 }).map((_, i) => <ShimmerBar key={i} />)
              : breakdownRows(full.breakdown).map((row) => (
                  <AuraSourceRow
                    key={row.key}
                    label={t(`aura.source.${row.key}` as MessageKey, locale)}
                    value={row.value}
                    width={row.width}
                  />
                ))}
          </View>
        ) : null}

        {/* Protection rules section */}
        {!query.isError ? (
          <View className="mt-8 gap-2">
            <SectionLabel>{t('aura.protection.title', locale)}</SectionLabel>
            {/* Rule 1: verified (◎ ring/check — vesica circle from esoteric set) */}
            <RuleRow
              glyph="◎"
              title={t('aura.rule.verified.title', locale)}
              desc={t('aura.rule.verified.desc', locale)}
            />
            {/* Rule 2: weighted (⚖ scales — balance/justice esoteric glyph) */}
            <RuleRow
              glyph="⚖"
              title={t('aura.rule.weighted.title', locale)}
              desc={t('aura.rule.weighted.desc', locale)}
            />
            {/* Rule 3: decay (◑ half-moon / time — waning cycle glyph) */}
            <RuleRow
              glyph="◑"
              title={t('aura.rule.decay.title', locale)}
              desc={t('aura.rule.decay.desc', locale)}
            />
          </View>
        ) : null}

        {/* Decay caption — only when idle > 30 days */}
        {idleDays !== null ? (
          <Text className="mt-4 text-[12px] text-muted-foreground">
            {t('aura.decay.caption', locale, { days: idleDays })}
          </Text>
        ) : null}

        {/* Ledger CTA */}
        {!query.isError ? (
          <Pressable
            className="mt-8 flex-row items-center justify-between border-t border-hair py-4"
            accessibilityRole="button"
            onPress={() => router.push('/aura/ledger' as Href)}
          >
            <Text className="text-[14px] text-foreground">{t('aura.ledger.cta', locale)}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
