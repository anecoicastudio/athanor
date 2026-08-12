import { useCallback, useEffect, useRef, useState } from 'react';
import { Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { semantic } from '@athanor/config';
import { deriveVerifyState } from '@athanor/core';
import { t } from '@athanor/i18n';
import {
  gdprKeys,
  getConsents,
  getVerificationStatus,
  setConsent,
  setLocationConsent,
  subscribeVerifyStatus,
  verifyKeys,
} from '@athanor/api';
import type { Consent } from '@athanor/schemas';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { ModalHeader } from '@/components/ModalHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { Toast } from '@/components/Toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { MODAL_A11Y } from '@/lib/a11y';
import { Screen } from '@/components/Screen';

/**
 * Trust & safety (M9 §3.1 + §3.5.3). Quote (the one cyan statement) · read-only Identity card
 * (status from profiles.identity_verified — the live verify flow is the identity-verify slice) ·
 * Privacy/GDPR toggles (approximate-location consent, comms consent, locked «non venduti»
 * statement) · Ethical-moderation section + «Segnala un comportamento» (→ existing report sheet).
 * Neutral chrome — no glow (rule #4). Optimistic consent toggles; zero hardcoded strings (rule #5).
 */
export default function TrustScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const verified = profile?.identity_verified ?? false;
  const qc = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }, []);
  // Clear a pending toast timer on unmount so it can't setToast on a dead component
  // (e.g. tapping «Segnala un comportamento» pushes a new modal mid-toast).
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  // Consent records (RLS-own). Absent row → default per kind (location ON, comms OFF).
  const consents = useQuery({
    queryKey: gdprKeys.consent(profile?.id ?? ''),
    queryFn: () => getConsents(supabase),
  });

  // Live identity-verification status (M9 identity-verify slice).
  const verifyQuery = useQuery({
    queryKey: verifyKeys.status(),
    queryFn: () => getVerificationStatus(supabase),
  });
  useEffect(() => {
    if (!profile?.id) return;
    return subscribeVerifyStatus(
      supabase,
      profile.id,
      () => void qc.invalidateQueries({ queryKey: verifyKeys.status() }),
    );
  }, [profile?.id, qc]);
  const verifyState = deriveVerifyState({
    identityVerified: verifyQuery.data?.identityVerified ?? verified,
    latestStatus: verifyQuery.data?.latestStatus ?? null,
  });
  const grantedFor = useCallback(
    (kind: Consent['kind'], fallback: boolean) =>
      consents.data?.find((c) => c.kind === kind)?.granted ?? fallback,
    [consents.data],
  );

  // Optimistic upsert into the cached consent list; roll back on error.
  const setConsentMut = useMutation({
    mutationFn: (v: { kind: Consent['kind']; granted: boolean }) =>
      v.kind === 'location_approx'
        ? setLocationConsent(supabase, v.granted)
        : setConsent(supabase, { kind: v.kind, granted: v.granted, source: 'settings' }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: gdprKeys.consent(profile?.id ?? '') });
      const prev = qc.getQueryData<Consent[]>(gdprKeys.consent(profile?.id ?? ''));
      qc.setQueryData<Consent[]>(gdprKeys.consent(profile?.id ?? ''), (old) => {
        const list = old ?? [];
        const i = list.findIndex((c) => c.kind === v.kind);
        const now = new Date().toISOString();
        if (i >= 0) {
          const copy = [...list];
          copy[i] = { ...copy[i]!, granted: v.granted, granted_at: now };
          return copy;
        }
        return [
          ...list,
          {
            // Transient client-only cache row (non-UUID id) — never round-trips through
            // consentSchema; replaced by the real row on onSettled invalidation.
            id: `optimistic-${v.kind}`,
            profile_id: profile?.id ?? '',
            kind: v.kind,
            granted: v.granted,
            granted_at: now,
            source: 'settings' as const,
            created_at: now,
            updated_at: now,
          },
        ];
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(gdprKeys.consent(profile?.id ?? ''), ctx.prev);
      flashToast(t('profile.error', locale));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: gdprKeys.consent(profile?.id ?? '') }),
  });

  return (
    <Screen {...MODAL_A11Y}>
      <ModalHeader title={t('trust.title', locale)} backLabel={t('common.back', locale)} />
      <ScrollView className="flex-1" contentContainerClassName="gap-6 pb-[104px] pt-2">
        {/* Quote — the single cyan statement (rule #4) */}
        <Text className="px-5 text-base font-semibold italic text-aura">
          {t('trust.quote', locale)}
        </Text>

        {/* Identity (read-only — verify flow is the identity-verify slice) */}
        <View className="gap-2 px-5">
          <SectionLabel tone="muted">{t('trust.identity.section', locale)}</SectionLabel>
          <Pressable
            onPress={() => {
              if (verifyState !== 'verified') router.push('/(modal)/verify');
            }}
            accessibilityRole="button"
            accessibilityLabel={t(`trust.identity.status.${verifyState}` as const, locale)}
            className="flex-row items-center gap-3 rounded-card border border-hair bg-raise p-5"
          >
            <Text
              className={
                verifyState === 'verified' ? 'text-2xl text-aura' : 'text-2xl text-muted-foreground'
              }
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {verifyState === 'verified' ? '✦' : '◇'}
            </Text>
            <View className="flex-1 gap-0.5">
              <Text className="text-base text-foreground">{t('trust.identity.title', locale)}</Text>
              <Text className="text-[13px] leading-snug text-muted-foreground">
                {t('trust.identity.desc', locale)}
              </Text>
            </View>
            {/* status chip — verified lights cyan (moment-grade, rule #4); others neutral */}
            <View
              className={
                verifyState === 'verified'
                  ? 'rounded-full border border-aura-line bg-aura-soft px-3 py-1.5'
                  : 'rounded-full border border-hair bg-raise-2 px-3 py-1.5'
              }
            >
              <Text
                className={
                  verifyState === 'verified' ? 'text-xs text-aura' : 'text-xs text-foreground'
                }
              >
                {t(`trust.identity.status.${verifyState}` as const, locale)}
              </Text>
            </View>
          </Pressable>
        </View>

        {/* Privacy by design · GDPR */}
        <View className="gap-2 px-5">
          <SectionLabel tone="muted">{t('trust.privacy.section', locale)}</SectionLabel>
          <View className="rounded-card border border-hair bg-raise">
            {/* dream visibility — navigational cross-link to the inline editor's
                «Il mio sogno» visibility control (no duplicate toggle); `edit=1`
                opens Profilo already in edit mode so the control is on screen.
                dismissTo (POP_TO), not push: (modal) is a sibling of (tabs) in the
                root Stack, so a push would stack a SECOND (tabs) instance over the
                still-open modal — an edit form with no back affordance. */}
            <Pressable
              onPress={() =>
                router.dismissTo({ pathname: '/(tabs)/profile', params: { edit: '1' } })
              }
              accessibilityRole="button"
              accessibilityLabel={t('trust.privacy.dream', locale)}
              className="flex-row items-center gap-4 border-b border-hair px-5 py-4"
            >
              <View className="flex-1 gap-0.5">
                <Text className="text-base text-foreground">
                  {t('trust.privacy.dream', locale)}
                </Text>
                <Text className="text-[13px] leading-snug text-muted-foreground">
                  {t('trust.privacy.dreamDesc', locale)}
                </Text>
              </View>
              <Text className="text-xl text-muted-foreground">›</Text>
            </Pressable>

            {/* approximate-location consent (default ON) */}
            <View className="flex-row items-center gap-4 border-b border-hair px-5 py-4">
              <View className="flex-1 gap-0.5">
                <Text className="text-base text-foreground">
                  {t('gdpr.location.label', locale)}
                </Text>
                <Text className="text-[13px] leading-snug text-muted-foreground">
                  {t('gdpr.location.desc', locale)}
                </Text>
              </View>
              <Switch
                value={grantedFor('location_approx', true)}
                onValueChange={(v) => setConsentMut.mutate({ kind: 'location_approx', granted: v })}
                trackColor={{ false: semantic.raise2, true: semantic.auraSoft }}
                thumbColor={semantic.foreground}
              />
            </View>

            {/* «non venduti» — locked statement, never mutates (§3.1) */}
            <View className="flex-row items-center gap-4 px-5 py-4 opacity-60">
              <View className="flex-1 gap-0.5">
                <Text className="text-base text-foreground">
                  {t('gdpr.neverSold.label', locale)}
                </Text>
                <Text className="text-[13px] leading-snug text-muted-foreground">
                  {t('gdpr.neverSold.desc', locale)}
                </Text>
              </View>
              <Switch
                value
                disabled
                accessibilityState={{ disabled: true }}
                trackColor={{ false: semantic.raise2, true: semantic.auraSoft }}
                thumbColor={semantic.foreground}
              />
            </View>
          </View>
        </View>

        {/* Consent management (§3.5.3) — comms opt-in (default OFF) */}
        <View className="gap-2 px-5">
          <SectionLabel tone="muted">{t('gdpr.consent.section', locale)}</SectionLabel>
          <View className="rounded-card border border-hair bg-raise">
            <View className="flex-row items-center gap-4 border-b border-hair px-5 py-4">
              <View className="flex-1 gap-0.5">
                <Text className="text-base text-foreground">{t('gdpr.consent.comms', locale)}</Text>
                <Text className="text-[13px] leading-snug text-muted-foreground">
                  {t('gdpr.consent.commsDesc', locale)}
                </Text>
              </View>
              <Switch
                value={grantedFor('comms', false)}
                onValueChange={(v) => setConsentMut.mutate({ kind: 'comms', granted: v })}
                trackColor={{ false: semantic.raise2, true: semantic.auraSoft }}
                thumbColor={semantic.foreground}
              />
            </View>

            {/* Diagnostics (crash reports) — default OFF; gates Sentry egress (P1.4 / B-5). */}
            <View className="flex-row items-center gap-4 px-5 py-4">
              <View className="flex-1 gap-0.5">
                <Text className="text-base text-foreground">
                  {t('gdpr.consent.diagnostics', locale)}
                </Text>
                <Text className="text-[13px] leading-snug text-muted-foreground">
                  {t('gdpr.consent.diagnosticsDesc', locale)}
                </Text>
              </View>
              <Switch
                value={grantedFor('analytics', false)}
                onValueChange={(v) => setConsentMut.mutate({ kind: 'analytics', granted: v })}
                trackColor={{ false: semantic.raise2, true: semantic.auraSoft }}
                thumbColor={semantic.foreground}
              />
            </View>
          </View>
        </View>

        {/* Ethical moderation + report CTA */}
        <View className="gap-2 px-5">
          <SectionLabel tone="muted">{t('trust.moderation.section', locale)}</SectionLabel>
          <View className="gap-3 rounded-card border border-hair bg-raise p-5">
            <Text className="text-[13px] leading-relaxed text-muted-foreground">
              {t('trust.moderation.intro', locale)}
            </Text>
            {(['selling', 'income', 'mlm'] as const).map((r) => (
              <View key={r} className="flex-row items-center gap-2">
                <Text className="text-muted-foreground">⊘</Text>
                <Text className="flex-1 text-sm text-foreground">
                  {t(`trust.moderation.rule.${r}` as const, locale)}
                </Text>
              </View>
            ))}
            <Text className="text-[13px] leading-relaxed text-muted-foreground">
              {t('trust.moderation.note', locale)}
            </Text>
            <Button
              variant="ghost"
              label={t('trust.report.cta', locale)}
              onPress={() =>
                router.push({ pathname: '/(modal)/report', params: { targetType: 'behavior' } })
              }
            />
          </View>
        </View>
      </ScrollView>

      {toast ? <Toast label={toast} /> : null}
    </Screen>
  );
}
