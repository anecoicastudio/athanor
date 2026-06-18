import { useCallback, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  circleKeys,
  entitlementKeys,
  getMyEntitlements,
  getMyMembership,
  openCustomerPortal,
  startCheckout,
} from '@athanor/api';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { AnalyticsLiteCard } from '@/components/circle/AnalyticsLiteCard';
import { BenefitRow } from '@/components/circle/BenefitRow';
import { PriceToggle, type PricePlan } from '@/components/circle/PriceToggle';
import { SubscriptionStatusCard } from '@/components/circle/SubscriptionStatusCard';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

// ── Benefit data (6 rows: 3 Fase-1, 3 Fase-2 soon) ─────────────────────────
const BENEFITS = [
  { key: 'tools', soon: true, fase1: false },
  { key: 'analytics', soon: false, fase1: true },
  { key: 'filters', soon: false, fase1: true },
  { key: 'events', soon: false, fase1: true },
  { key: 'market', soon: true, fase1: false },
  { key: 'ai', soon: true, fase1: false },
] as const;

export default function CircleScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const locale = profile?.locale ?? 'it';
  const profileId = profile?.id ?? '';

  // ── Local UI state ──────────────────────────────────────────────────────────
  const [plan, setPlan] = useState<PricePlan>('monthly');
  const [checkoutPhase, setCheckoutPhase] = useState<'idle' | 'opening' | 'portal'>('idle');

  // ── Entitlements query ──────────────────────────────────────────────────────
  const entQuery = useQuery({
    queryKey: entitlementKeys.me(),
    queryFn: () => getMyEntitlements(supabase),
    staleTime: 30_000,
  });

  const isMember = entQuery.data?.is_member ?? false;

  // ── Membership detail query (renewal date, founding flag) ───────────────────
  const memberQuery = useQuery({
    queryKey: circleKeys.subscription(profileId),
    queryFn: () => getMyMembership(supabase, profileId),
    enabled: isMember && !!profileId,
    staleTime: 30_000,
  });

  // ── Re-invalidate on focus: webhook may land after Checkout/Portal return ───
  useFocusEffect(
    useCallback(() => {
      qc.invalidateQueries({ queryKey: entitlementKeys.me() });
      if (profileId) qc.invalidateQueries({ queryKey: circleKeys.subscription(profileId) });
    }, [profileId, qc]),
  );

  // ── Checkout handler ────────────────────────────────────────────────────────
  const onJoin = useCallback(async () => {
    setCheckoutPhase('opening');
    try {
      const result = await startCheckout(supabase, { plan });
      if (result.kind === 'url') {
        const browserResult = await WebBrowser.openAuthSessionAsync(result.url, 'athanor://circle');
        if (browserResult.type === 'success' && browserResult.url) {
          Linking.parse(browserResult.url); // parse for side-effects; success = webhook will land
        }
        // Invalidate regardless of result type (webhook may have landed)
        qc.invalidateQueries({ queryKey: entitlementKeys.me() });
        qc.invalidateQueries({ queryKey: circleKeys.subscription(profileId) });
      } else if (result.kind === 'iap') {
        // TODO(M10 S-IAP-1): StoreKit IAP path — unreachable in M8
        // The edge function currently only returns { kind: 'url' }
      }
    } catch {
      // Error is surfaced via query error state on next invalidate
    } finally {
      setCheckoutPhase('idle');
    }
  }, [plan, profileId, qc]);

  // ── Portal handler ──────────────────────────────────────────────────────────
  const onManage = useCallback(async () => {
    setCheckoutPhase('portal');
    try {
      const { url } = await openCustomerPortal(supabase);
      await WebBrowser.openAuthSessionAsync(url, 'athanor://circle');
      qc.invalidateQueries({ queryKey: entitlementKeys.me() });
      qc.invalidateQueries({ queryKey: circleKeys.subscription(profileId) });
    } catch {
      // Error handled silently; invalidate anyway
      qc.invalidateQueries({ queryKey: entitlementKeys.me() });
    } finally {
      setCheckoutPhase('idle');
    }
  }, [profileId, qc]);

  // ── Loading state ────────────────────────────────────────────────────────────
  if (entQuery.isLoading) {
    return (
      <View className="flex-1 bg-background">
        <View className="flex-row items-center gap-3 px-5 pb-3 pt-14">
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            accessibilityLabel={t('common.back', locale)}
          >
            <Text className="text-[22px] text-foreground">‹</Text>
          </Pressable>
          <Text className="text-2xl text-foreground">{t('circle.title', locale)}</Text>
        </View>
        <View className="flex-1 items-center justify-center gap-4 px-5">
          <ActivityIndicator color={semantic.aura} />
        </View>
      </View>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────────
  if (entQuery.isError) {
    return (
      <View className="flex-1 bg-background">
        <View className="flex-row items-center gap-3 px-5 pb-3 pt-14">
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            accessibilityLabel={t('common.back', locale)}
          >
            <Text className="text-[22px] text-foreground">‹</Text>
          </Pressable>
          <Text className="text-2xl text-foreground">{t('circle.title', locale)}</Text>
        </View>
        <View className="flex-1 items-center justify-center px-5">
          <EmptyState>
            {t('circle.error.title', locale)}
            {'\n'}
            <Pressable onPress={() => void entQuery.refetch()}>
              <Text className="text-aura">{t('circle.error.retry', locale)}</Text>
            </Pressable>
          </EmptyState>
        </View>
      </View>
    );
  }

  // ── Shared header ────────────────────────────────────────────────────────────
  const header = (
    <View className="flex-row items-center gap-3 px-5 pb-3 pt-14">
      <Pressable
        onPress={() => router.back()}
        hitSlop={8}
        accessibilityLabel={t('common.back', locale)}
      >
        <Text className="text-[22px] text-foreground">‹</Text>
      </Pressable>
      <Text className="text-2xl text-foreground">{t('circle.title', locale)}</Text>
    </View>
  );

  // ── Shared zero-Aura footnote (REQUIRED on both states, rule #1) ─────────────
  const zeroAuraNote = (
    <Text className="text-[13px] leading-5 text-muted-foreground">
      {t('circle.zeroAura.note', locale)}
    </Text>
  );

  // ── Benefit list (shared, unlocked flag differs per state) ──────────────────
  const benefitList = (unlocked: boolean) =>
    BENEFITS.map(({ key, soon }) => (
      <BenefitRow
        key={key}
        title={t(`circle.benefit.${key}.t`, locale)}
        desc={t(`circle.benefit.${key}.d`, locale)}
        unlocked={unlocked}
        soon={soon}
        locale={locale}
      />
    ));

  // ── MEMBER STATE ─────────────────────────────────────────────────────────────
  if (isMember) {
    const membership = memberQuery.data ?? null;
    return (
      <View className="flex-1 bg-background">
        {header}
        <ScrollView className="flex-1" contentContainerClassName="gap-6 px-5 pb-[104px]">
          {/* 1. Subscription status card (moment glow — belonging is moment-grade) */}
          <SubscriptionStatusCard
            plan={membership?.plan ?? entQuery.data?.plan ?? null}
            status={membership?.status ?? entQuery.data?.status ?? null}
            currentPeriodEnd={membership?.current_period_end ?? null}
            founding={membership?.founding_member ?? entQuery.data?.founding ?? false}
            locale={locale}
          />

          {/* 2. Analytics lite card — member-only self-impact data (rule #3) */}
          <AnalyticsLiteCard profileId={profileId} locale={locale} />

          {/* 3. Six benefits — all rendered as unlocked for members */}
          <View className="gap-2">{benefitList(true)}</View>

          {/* 4. Manage button → Stripe Customer Portal */}
          <Button
            label={checkoutPhase === 'portal' ? '…' : t('circle.member.manage', locale)}
            onPress={() => void onManage()}
            variant="ghost"
            disabled={checkoutPhase !== 'idle'}
          />

          {/* 5. Zero-Aura assurance — REQUIRED for member state too (rule #1) */}
          {zeroAuraNote}
        </ScrollView>
      </View>
    );
  }

  // ── NON-MEMBER STATE ─────────────────────────────────────────────────────────
  return (
    <View className="flex-1 bg-background">
      {header}
      <ScrollView className="flex-1" contentContainerClassName="gap-6 px-5 pb-[104px]">
        {/* 1. FeatureCard violet — pitch block */}
        <View className="rounded-card border border-hair bg-raise p-5 gap-4">
          {/* Eyebrow */}
          <Text className="text-[12px] uppercase tracking-wider text-aura">
            {t('circle.eyebrow', locale)}
          </Text>

          {/* Headline */}
          <Text className="text-[22px] font-bold text-foreground">
            {t('circle.headline', locale)}
          </Text>

          {/* Assurance quote — cyan, the brand line, load-bearing (rule #1) */}
          <Text className="text-[15px] font-semibold leading-6 text-aura">
            {t('circle.assurance.quote', locale)}
          </Text>

          {/* Assurance body */}
          <Text className="text-[14px] leading-5 text-muted-foreground">
            {t('circle.assurance.body', locale)}
          </Text>
        </View>

        {/* 2. Price toggle */}
        <View className="gap-2">
          <PriceToggle value={plan} onChange={setPlan} locale={locale} />
          {plan === 'annual' ? (
            <Text className="text-center text-[13px] text-muted-foreground">
              {t('circle.plan.annualNote', locale)}
            </Text>
          ) : null}
        </View>

        {/* 3. Six benefit rows (non-member: all shown, locked visual for Fase-2) */}
        <View className="gap-2">{benefitList(false)}</View>

        {/* 4. Join CTA — light glow (joining is moment-grade, rule #4) */}
        <Button
          label={
            checkoutPhase === 'opening'
              ? '…'
              : plan === 'annual'
                ? t('circle.cta.annual', locale)
                : t('circle.cta.monthly', locale)
          }
          onPress={() => void onJoin()}
          variant="light"
          glow
          disabled={checkoutPhase !== 'idle'}
        />

        {/* 5. Zero-Aura assurance footnote — REQUIRED on non-member state (rule #1) */}
        {zeroAuraNote}
      </ScrollView>
    </View>
  );
}
