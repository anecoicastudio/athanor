import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fundKeys, getActiveEdition, getFundAggregate, subscribeFundAggregate } from '@athanor/api';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { SectionLabel } from '@/components/SectionLabel';
import { CountdownGrid } from '@/components/fund/CountdownGrid';
import { FundTicker } from '@/components/fund/FundTicker';
import { SplitBar } from '@/components/fund/SplitBar';
import { PhaseList } from '@/components/fund/PhaseList';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

export default function AnnualFundScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const locale = profile?.locale ?? 'it';
  const [candidateSoon, setCandidateSoon] = useState(false);

  // ── Edition query ────────────────────────────────────────────────────────────
  const editionQuery = useQuery({
    queryKey: fundKeys.activeEdition(),
    queryFn: () => getActiveEdition(supabase),
  });

  const edition = editionQuery.data ?? null;

  // ── Aggregate query (only when edition exists) ───────────────────────────────
  const qc = useQueryClient();
  const aggregateQuery = useQuery({
    queryKey: fundKeys.aggregate(edition?.id ?? ''),
    queryFn: () => getFundAggregate(supabase, edition!.id),
    enabled: !!edition?.id,
  });

  // ── Realtime subscription (fund ticker) ─────────────────────────────────────
  const [live, setLive] = useState(false);

  useEffect(() => {
    const editionId = edition?.id;
    if (!editionId) return;

    const cleanup = subscribeFundAggregate(
      supabase,
      editionId,
      (agg) => qc.setQueryData(fundKeys.aggregate(editionId), agg),
      (status) => setLive(status === 'SUBSCRIBED'),
    );

    return cleanup;
  }, [edition?.id, qc]);

  // Flatten aggregate values (0 when null / not yet arrived)
  const agg = aggregateQuery.data ?? null;
  const raisedCents = agg?.raised_cents ?? 0;
  const contributorCount = agg?.contributor_count ?? 0;
  const goalCents = edition?.goal_cents ?? 0;

  // ── «Candida il tuo sogno» hint (mirrors Home actionSoon pattern) ─────────────
  const onCandidatePress = () => {
    setCandidateSoon(true);
    setTimeout(() => setCandidateSoon(false), 2000);
  };

  // ── Loading state ────────────────────────────────────────────────────────────
  if (editionQuery.isLoading) {
    return (
      <View className="flex-1 bg-background">
        {/* Header */}
        <View className="flex-row items-center gap-3 px-5 pb-3 pt-14">
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            accessibilityLabel={t('common.back', locale)}
          >
            <Text className="text-[22px] text-foreground">‹</Text>
          </Pressable>
          <Text className="text-2xl text-foreground">{t('fund.title', locale)}</Text>
        </View>
        {/* Skeleton / quiet placeholder */}
        <View className="flex-1 items-center justify-center gap-4 px-5">
          <ActivityIndicator color={semantic.aura} />
          <Text className="text-[13px] text-muted-foreground">— — —</Text>
        </View>
      </View>
    );
  }

  // ── No active edition ────────────────────────────────────────────────────────
  if (!edition) {
    return (
      <View className="flex-1 bg-background">
        {/* Header */}
        <View className="flex-row items-center gap-3 px-5 pb-3 pt-14">
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            accessibilityLabel={t('common.back', locale)}
          >
            <Text className="text-[22px] text-foreground">‹</Text>
          </Pressable>
          <Text className="text-2xl text-foreground">{t('fund.title', locale)}</Text>
        </View>
        {/* Calm empty state */}
        <View className="flex-1 items-center justify-center px-5">
          <Text className="text-center text-[15px] text-muted-foreground">
            {t('fund.empty', locale)}
          </Text>
        </View>
      </View>
    );
  }

  // ── Live screen (full composition) ──────────────────────────────────────────
  return (
    <View className="flex-1 bg-background">
      {/* 1. Header — back chevron + fund.title */}
      <View className="flex-row items-center gap-3 px-5 pb-3 pt-14">
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityLabel={t('common.back', locale)}
        >
          <Text className="text-[22px] text-foreground">‹</Text>
        </Pressable>
        <Text className="text-2xl text-foreground">{t('fund.title', locale)}</Text>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="gap-8 px-5 pb-16">
        {/* 2. Hero quote — brand voice, cyan (NOT Hanken-italic dream register) */}
        <Text className="text-center text-[15px] leading-6 text-aura">
          {t('fund.hero.quote', locale)}
        </Text>

        {/* 3. Hero countdown block */}
        <View className="gap-4">
          <Text className="text-[12px] uppercase tracking-wider text-muted-foreground">
            {t('fund.countdown.label', locale)}
          </Text>
          <CountdownGrid targetMs={Date.parse(edition.target_at)} locale={locale} />
          <FundTicker
            raisedCents={raisedCents}
            contributorCount={contributorCount}
            goalCents={goalCents}
            live={live}
            locale={locale}
          />
        </View>

        {/* 4. «Candida il tuo sogno» — flat light Button; candidacy is a later slice */}
        <View className="gap-2">
          <Button
            label={t('fund.candidate.cta', locale)}
            onPress={onCandidatePress}
            variant="light"
            // No glow — flat CTA, rule #4
          />
          {candidateSoon ? (
            <Text className="text-center text-[13px] text-muted-foreground">
              {t('fund.candidate.soon', locale)}
            </Text>
          ) : null}
        </View>

        {/* 5. Come si divide il fondo */}
        <View className="gap-3">
          <SectionLabel>{t('fund.split.title', locale)}</SectionLabel>
          <SplitBar locale={locale} />
          <Text className="text-[14px] leading-5 text-muted-foreground">
            {t('fund.split.body', locale)}
          </Text>
        </View>

        {/* 6. Partecipa — locked variant (production default)
            contributions_enabled defaults false.
            When true, still render the locked variant this slice — the interactive
            amount chips + Stripe CTA ship in the contributions slice.
            TODO(M7-contributions): replace with interactive Stripe flow when contributions_enabled */}
        <View className="gap-3">
          <SectionLabel>{t('fund.contribute.title', locale)}</SectionLabel>
          <Text className="text-[14px] leading-5 text-foreground">
            {t('fund.contribute.intro', locale)}
          </Text>
          <Button
            label={t('fund.contribute.soon', locale)}
            onPress={() => {}}
            variant="ghost"
            disabled
          />
          <Text className="text-[12px] text-muted-foreground">
            {t('fund.contribute.soonNote', locale)}
          </Text>
          <Text className="text-[12px] text-muted-foreground">
            {t('fund.contribute.zeroAura', locale)}
          </Text>
        </View>

        {/* 7. Sogni candidati — calm empty hint; candidate cards land in voting/candidacy slices
            TODO(M7-candidacy): replace with real candidate cards */}
        <View className="gap-3">
          <SectionLabel>{t('fund.candidates.title', locale)}</SectionLabel>
          <Text className="text-[14px] text-muted-foreground">
            {t('fund.candidates.empty', locale)}
          </Text>
        </View>

        {/* 8. Come vengono scelti */}
        <View className="gap-3">
          <SectionLabel>{t('fund.howChosen.title', locale)}</SectionLabel>
          <PhaseList current={edition.phase} locale={locale} />
        </View>

        {/* 9. Il motore virale — cyan-wash card */}
        <View className="rounded-card border border-aura-line bg-aura-soft p-5 gap-3">
          <Text className="text-[12px] uppercase tracking-wider text-aura">
            {t('fund.viral.label', locale)}
          </Text>
          <Text className="text-[14px] leading-5 text-foreground">
            {t('fund.viral.tagline1', locale)}
          </Text>
          <Text className="text-[14px] leading-5 text-foreground">
            {t('fund.viral.tagline2', locale)}
          </Text>
          <Text className="text-[14px] leading-5 text-foreground">
            {t('fund.viral.tagline3', locale)}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
