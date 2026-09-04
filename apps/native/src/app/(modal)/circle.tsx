import { useCallback, useState } from 'react';
import { ActivityIndicator, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  circleKeys,
  entitlementKeys,
  getCirclePrices,
  getMyMembership,
  openCustomerPortal,
  startCheckout,
} from '@athanor/api';
import { semantic } from '@athanor/config';
import { circleAnnualSavings, formatPrice } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { CirclePlan } from '@athanor/schemas';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { useEntitlement } from '@/hooks/use-entitlement';
import { useLocale } from '@/hooks/use-locale';
import { Button } from '@/components/Button';
import { ModalHeader } from '@/components/ModalHeader';
import { useToast } from '@/components/ToastHost';
import { ListState } from '@/components/ListState';
import { listState } from '@/lib/list-state';
import { AnalyticsLiteCard } from '@/components/circle/AnalyticsLiteCard';
import { BenefitRow } from '@/components/circle/BenefitRow';
import { PriceToggle } from '@/components/circle/PriceToggle';
import { SectionLabel } from '@/components/SectionLabel';
import { SubscriptionStatusCard } from '@/components/circle/SubscriptionStatusCard';
import { useAuth } from '@/lib/auth-context';
import { LEGAL_PRIVACY_URL, LEGAL_TERMS_URL } from '@/lib/links';
import { devWarn } from '@/lib/log';
import { supabase } from '@/lib/supabase';
import { MODAL_A11Y } from '@/lib/a11y';
import { Screen } from '@/components/Screen';

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
  const qc = useQueryClient();
  const locale = useLocale();
  const { showToast } = useToast();
  const profileId = profile?.id ?? '';

  // ── Local UI state ──────────────────────────────────────────────────────────
  const [plan, setPlan] = useState<CirclePlan>('monthly');
  const [checkoutPhase, setCheckoutPhase] = useState<'idle' | 'opening' | 'portal'>('idle');
  const [checkoutError, setCheckoutError] = useState(false);
  const [portalError, setPortalError] = useState(false);

  // ── Entitlements query ──────────────────────────────────────────────────────
  // Shares the canonical EntitlementView shape + cache key with CircleGate's
  // useEntitlement(). Both MUST map through the same queryFn — a second useQuery on
  // entitlementKeys.me() returning the raw flat row would poison the shared cache and
  // crash CircleGate (it reads entitlement.features.*).
  const entQuery = useEntitlement();

  const isMember = entQuery.data?.isMember ?? false;

  // ── Live Stripe amounts (#644) ──────────────────────────────────────────────
  // The catalog used to carry «€12/mese» and «€99/anno» as literals while the charge came
  // from Stripe Price ids, so a Dashboard edit shipped an app that quoted one number and
  // charged another. The amounts now arrive from get-circle-prices and the keys carry only
  // the template. There is deliberately NO fallback literal: until they arrive the CTA slot
  // shows a spinner, and if the read fails it shows a retry — a quoted price that is not the
  // charged one is the defect this closes.
  // `enabled` skips the surfaces that render no price: iOS hides the whole purchase block
  // (Apple 3.1.1 / S-IAP-1), and a member sees their plan instead of the toggle. `isMember`
  // is false until entitlements land, so a member's first render can still fire one read —
  // deliberately, rather than serialising two round trips for the people who came to see a
  // price.
  // `persist: false` is the load-bearing option here, not a tuning knob: the shared client
  // dehydrates every query to AsyncStorage with a 24h gcTime (`lib/query-client.ts`), so
  // without it a launch would hydrate yesterday's amount and paint it as the price — a
  // catalog literal again, just with extra steps. Opting out means a cold start always asks
  // Stripe; `staleTime` then governs re-reads inside one session, and five minutes is
  // generous for a number that changes about never.
  const pricesQuery = useQuery({
    queryKey: circleKeys.plans(),
    queryFn: () => getCirclePrices(supabase),
    enabled: !isMember && Platform.OS !== 'ios',
    staleTime: 5 * 60_000,
    meta: { persist: false },
  });
  const prices = pricesQuery.data ?? null;
  const savings = prices ? circleAnnualSavings(prices.monthly, prices.annual) : null;
  // `staleWins: false` for the same reason the Aura surfaces use it: a stale number presented
  // as today's is the false confidence this issue exists to remove, and a price is a promise
  // about money. `paused` therefore stays a spinner (#111's rule: offline-with-intent has
  // neither failed nor answered) — and resolves on its own when the connection returns,
  // because nothing about this query is cached to fall back on. `empty` is unreachable: the
  // queryFn parses or throws, so a settled success always carries both plans.
  //
  // A retry in flight reads as loading, not as the error it is retrying (#674 item 2). The
  // pair `status: 'error'` + `fetchStatus: 'fetching'` is exactly a tapped retry, and
  // `listState` maps it to `'error'`, so the tap used to give zero feedback — the same copy
  // and the same button, with nothing to say the read was under way. Kept caller-local rather
  // than folded into `listState`: on a list, swapping the error copy for a spinner mid-retry
  // would blank the message the member is reading; here there is nothing else in the slot.
  const retrying = pricesQuery.status === 'error' && pricesQuery.fetchStatus === 'fetching';
  const priceState = retrying
    ? 'loading'
    : listState({
        status: pricesQuery.status,
        fetchStatus: pricesQuery.fetchStatus,
        isEmpty: prices == null,
        staleWins: false,
      });

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
    setCheckoutError(false);
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
        // TODO(M10 S-IAP-1): StoreKit IAP path — unreachable in M8, the edge function only
        // returns { kind: 'url' }. Loud rather than empty: if an `iap` result ever arrives
        // before the StoreKit flow exists, the member gets an error instead of a spinner
        // that stops with nothing having happened.
        devWarn('[circle] startCheckout', 'returned kind=iap — StoreKit path not implemented');
        setCheckoutError(true);
      }
    } catch {
      // Checkout-session failure happens before any subscription exists, so the query
      // error state never fires — surface it inline instead.
      setCheckoutError(true);
    } finally {
      setCheckoutPhase('idle');
    }
  }, [plan, profileId, qc]);

  // ── Portal handler ──────────────────────────────────────────────────────────
  const onManage = useCallback(async () => {
    setCheckoutPhase('portal');
    setPortalError(false);
    try {
      const { url } = await openCustomerPortal(supabase);
      await WebBrowser.openAuthSessionAsync(url, 'athanor://circle');
      qc.invalidateQueries({ queryKey: entitlementKeys.me() });
      qc.invalidateQueries({ queryKey: circleKeys.subscription(profileId) });
    } catch (e) {
      // Portal-session failure happens before Stripe opens — tell the member the tap
      // did nothing (was fully swallowed pre-2026-07-09 audit); invalidate anyway.
      devWarn('[circle] openCustomerPortal', e);
      setPortalError(true);
      qc.invalidateQueries({ queryKey: entitlementKeys.me() });
      qc.invalidateQueries({ queryKey: circleKeys.subscription(profileId) });
    } finally {
      setCheckoutPhase('idle');
    }
  }, [profileId, qc]);

  // ── Loading state ────────────────────────────────────────────────────────────
  if (entQuery.isLoading) {
    return (
      <Screen {...MODAL_A11Y}>
        <ModalHeader title={t('circle.title', locale)} backLabel={t('common.back', locale)} />
        <View className="flex-1 items-center justify-center gap-4 px-5">
          <ActivityIndicator color={semantic.aura} />
        </View>
      </Screen>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────────
  if (entQuery.isError) {
    return (
      <Screen {...MODAL_A11Y}>
        <ModalHeader title={t('circle.title', locale)} backLabel={t('common.back', locale)} />
        {/* The retry used to be a `Pressable` nested inside `EmptyState`'s `<Text>` children —
            a touchable inside a text node, with no accessibilityRole, reached by a literal
            '\n'. `ListState` gives it the same ghost Button every other error arm uses (#111).
            `circle.error.retry` is now unused: `common.retry` says the same word. */}
        <ListState
          state="error"
          locale={locale}
          errorLabel={t('circle.error.title', locale)}
          onRetry={() => void entQuery.refetch()}
          className="flex-1 justify-center px-5"
        />
      </Screen>
    );
  }

  // ── Shared header ────────────────────────────────────────────────────────────
  const header = (
    <ModalHeader title={t('circle.title', locale)} backLabel={t('common.back', locale)} />
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
      <Screen {...MODAL_A11Y}>
        {header}
        <ScrollView className="flex-1" contentContainerClassName="gap-6 px-5 pb-12">
          {/* 1. Subscription status card (moment glow — belonging is moment-grade) */}
          <SubscriptionStatusCard
            plan={membership?.plan ?? entQuery.data?.plan ?? null}
            status={membership?.status ?? entQuery.data?.status ?? null}
            currentPeriodEnd={membership?.current_period_end ?? null}
            // #511 — only the membership row carries this; entitlements deliberately does not
            // (a cancelled member keeps every benefit until the period ends).
            cancelAtPeriodEnd={membership?.cancel_at_period_end ?? false}
            founding={membership?.founding_member ?? entQuery.data?.founding ?? false}
            locale={locale}
          />

          {/* 2. Analytics lite card — member-only self-impact data (rule #3) */}
          {/* Gated on the entitlements bit (P5) — server-derived view stays the switch */}
          {entQuery.data?.features.analytics ? (
            <AnalyticsLiteCard profileId={profileId} locale={locale} />
          ) : null}

          {/* 3. Six benefits — all rendered as unlocked for members */}
          <View className="gap-2">{benefitList(true)}</View>

          {/* 4. Manage → Stripe Customer Portal (non-iOS). On iOS, opening the
              hosted billing portal in-app is the same Apple 3.1.1 surface as the
              subscribe CTA (S-IAP-1) — show a neutral, non-steering note instead. */}
          {Platform.OS === 'ios' ? (
            <Text className="text-[13px] leading-5 text-muted-foreground">
              {t('circle.iosManageUnavailable', locale)}
            </Text>
          ) : (
            <Button
              label={checkoutPhase === 'portal' ? '…' : t('circle.member.manage', locale)}
              onPress={() => void onManage()}
              variant="ghost"
              disabled={checkoutPhase !== 'idle'}
            />
          )}
          {portalError ? (
            <Text className="text-center text-[13px] text-error">
              {t('circle.portal.error', locale)}
            </Text>
          ) : null}

          {/* 5. Zero-Aura assurance — REQUIRED for member state too (rule #1) */}
          {zeroAuraNote}
        </ScrollView>
      </Screen>
    );
  }

  // ── NON-MEMBER STATE ─────────────────────────────────────────────────────────
  return (
    <Screen {...MODAL_A11Y}>
      {header}
      <ScrollView className="flex-1" contentContainerClassName="gap-6 px-5 pb-12">
        {/* 1. FeatureCard violet — pitch block */}
        <View className="rounded-card border border-hair bg-raise p-5 gap-4">
          {/* Eyebrow */}
          <SectionLabel tone="aura">{t('circle.eyebrow', locale)}</SectionLabel>

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

        {/* 2. Price toggle — hidden on iOS (Apple 3.1.1 / S-IAP-1: no in-app subscribe).
            Each segment carries its live amount (#675), and the savings line sits under the
            toggle whenever the annual plan actually saves something — from the DEFAULT
            (monthly) state too, so the reason to pick annual is visible before it is picked.
            It used to appear only once annual was selected, which also made the CTA jump
            under the thumb on every toggle (run 12). Numerals: tabular, no tracking. */}
        {Platform.OS !== 'ios' ? (
          <View className="gap-2">
            <PriceToggle value={plan} onChange={setPlan} locale={locale} prices={prices} />
            {priceState === 'ready' && savings ? (
              <View className="items-center">
                <View className="rounded-full border border-hair bg-raise px-3 py-1">
                  <Text
                    className="text-[13px] text-foreground"
                    style={{ fontVariant: ['tabular-nums'] }}
                  >
                    {t('circle.plan.annualNote', locale, {
                      amount: formatPrice(savings.cents, savings.currency, locale),
                    })}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* 3. Six benefit rows (non-member: all shown, locked visual for Fase-2) */}
        <View className="gap-2">{benefitList(false)}</View>

        {/* 4. Join CTA (non-iOS) — flat cyan, no glow: a subscription checkout is
            commerce, not a moment-grade event (rule #4 / DESIGN §2.3).
            On iOS the in-app Stripe subscribe button is forbidden (Apple 3.1.1 /
            S-IAP-1); show a neutral, non-steering note instead. Apple IAP deferred. */}
        {Platform.OS === 'ios' ? (
          <Text className="text-[13px] leading-5 text-muted-foreground">
            {t('circle.iosUnavailable', locale)}
          </Text>
        ) : priceState === 'ready' && prices ? (
          <Button
            label={t(plan === 'annual' ? 'circle.cta.annual' : 'circle.cta.monthly', locale, {
              price: formatPrice(prices[plan].unitAmount, prices[plan].currency, locale),
            })}
            onPress={() => void onJoin()}
            variant="light"
            disabled={checkoutPhase !== 'idle'}
            // `loading` instead of the old '…' label swap: the spinner + busy state are
            // what Button implements for exactly this, and «…» was unpronounceable to
            // VoiceOver while hiding the price mid-tap (#632 review finding).
            loading={checkoutPhase === 'opening'}
          />
        ) : (
          // No amounts, no order button: quoting a price is what makes this control an offer,
          // and an unpriced «Entra nel Circle» is the EU price-indication hole #644 names.
          // `ListState` is this repo's error arm (#111) — spinner while it loads, named
          // failure plus a retry when the read fails.
          <ListState
            state={priceState}
            locale={locale}
            errorLabel={t('circle.price.error', locale)}
            onRetry={() => void pricesQuery.refetch()}
            className="items-center gap-4 py-2"
          />
        )}
        {checkoutError ? (
          <Text className="text-center text-[13px] text-error">
            {t('circle.error.title', locale)}
          </Text>
        ) : null}

        {/* 4b. Subscription disclosures (#632): renewal + exit, then the Terms/Privacy
            links. App Store 3.1.2 and EU consumer law both want these before the order
            button's screen ends — and a screen that leads with «la visibilità non si
            compra» owes the reader the way out in the same breath. The renewal sentence
            renders only where subscribing is possible (non-iOS); the links always. */}
        {Platform.OS !== 'ios' ? (
          <Text className="text-[13px] leading-5 text-muted-foreground">
            {t('circle.legal.renewal', locale)}
          </Text>
        ) : null}
        <View className="flex-row items-center gap-6">
          {(
            [
              ['settings.legal.terms', LEGAL_TERMS_URL],
              ['settings.legal.privacy', LEGAL_PRIVACY_URL],
            ] as const
          ).map(([key, url]) => (
            <Pressable
              key={key}
              className="min-h-[44px] justify-center"
              accessibilityRole="link"
              onPress={() => {
                WebBrowser.openBrowserAsync(url).catch(() =>
                  showToast(t('settings.legal.error', locale)),
                );
              }}
            >
              <Text className="text-[13px] text-muted-foreground underline">{t(key, locale)}</Text>
            </Pressable>
          ))}
        </View>

        {/* 5. Zero-Aura assurance footnote — REQUIRED on non-member state (rule #1) */}
        {zeroAuraNote}
      </ScrollView>
    </Screen>
  );
}
