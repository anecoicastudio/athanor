import { useState } from 'react';
import { Linking, Share } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useQuery } from '@tanstack/react-query';
import {
  auraKeys,
  blockKeys,
  getAuraScore,
  getBlockedCount,
  getMyReferralCode,
  inviteKeys,
  updateProfile,
} from '@athanor/api';
import { memberLabel } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { ScrollView, Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { Chip } from '@/components/Chip';
import { ModalHeader } from '@/components/ModalHeader';
import { SettingsGroup } from '@/components/settings/SettingsGroup';
import { useToast } from '@/components/ToastHost';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { auraDisplayValue } from '@/lib/aura-display';
import { useAuth } from '@/lib/auth-context';
import { INVITE_URL_BASE, LEGAL_PRIVACY_URL, LEGAL_TERMS_URL, SUPPORT_EMAIL } from '@/lib/links';
import { useEntitlement } from '@/hooks/use-entitlement';
import { useFeatureFlags } from '@/hooks/use-remote-config';
import { supabase } from '@/lib/supabase';
import { MODAL_A11Y } from '@/lib/a11y';
import { Screen } from '@/components/Screen';

/**
 * Settings (PRD §4, M1 §3.4) — account hub. M1 ships full chrome; most rows
 * navigate to later-milestone screens, stubbed here as calm toasts. Functional
 * in M1: Lingua (persists profiles.locale), Esci (sign-out), version footer.
 * Aura value is read-only (rule #1); identity_verified not shipped yet → the
 * account subtitle is always the unverified variant.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { session, profile, refreshProfile } = useAuth();
  const { data: entitlement } = useEntitlement();
  const flags = useFeatureFlags();

  const { showToast } = useToast();
  const [langBusy, setLangBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const locale: Locale = profile?.locale ?? 'it';
  const email = session?.user.email ?? '';
  const version = Constants.expoConfig?.version ?? '1.0.0';

  // Owner-private count for the blocked-profiles subtitle (rule #3: never public).
  const { data: blockedCount = 0 } = useQuery({
    queryKey: blockKeys.count(),
    queryFn: () => getBlockedCount(supabase),
  });

  // Personal referral code, appended to the Invite row's share link (P4.1).
  const { data: referralCode } = useQuery({
    queryKey: inviteKeys.code(),
    queryFn: () => getMyReferralCode(supabase),
  });

  // Read-only Aura snapshot. Shares auraKeys.score + getAuraScore with profile.tsx/Home
  // (one queryFn per key).
  const userId = session?.user.id ?? '';
  const { data: auraSnapshot, isError: auraIsError } = useQuery({
    queryKey: auraKeys.score(userId),
    queryFn: () => getAuraScore(supabase, userId),
    enabled: !!userId,
  });
  const aura = auraDisplayValue(auraSnapshot?.score, auraIsError);

  const switchLocale = async (next: Locale) => {
    const userId = session?.user.id;
    if (!userId || next === locale || langBusy) return;
    setLangBusy(true);
    try {
      await updateProfile(supabase, userId, { locale: next });
      await refreshProfile();
      showToast(t(next === 'it' ? 'settings.lang.it' : 'settings.lang.en', next), 'success');
    } catch {
      showToast(t('profile.error', locale));
    } finally {
      setLangBusy(false);
    }
  };

  const signOut = () => {
    if (signingOut) return;
    setSigningOut(true);
    showToast(t('settings.logout.toast', locale), 'moment');
    // Brief farewell, then end the session — AuthGuard routes to (auth)/welcome.
    setTimeout(() => {
      supabase.auth.signOut().catch(() => setSigningOut(false));
    }, 700);
  };

  return (
    <Screen {...MODAL_A11Y}>
      {/* Header: back + title */}
      <ModalHeader title={t('settings.title', locale)} backLabel={t('common.back', locale)} />

      <ScrollView className="flex-1" contentContainerClassName="gap-7 px-5 pb-12">
        {/* Account card */}
        <View className="flex-row items-center gap-4 rounded-card border border-hair bg-raise p-5">
          <Avatar
            handle={profile?.handle ?? null}
            displayName={profile?.display_name ?? null}
            avatarPath={profile?.avatar_path ?? null}
            size={56}
          />
          <View className="flex-1 gap-1">
            <Text className="text-lg font-semibold text-foreground">
              {memberLabel(profile?.display_name, profile?.handle) ?? '—'}
            </Text>
            <Text className="text-[13px] text-faint">
              {t('settings.account.subUnverified', locale, { email })}
            </Text>
          </View>
        </View>

        {/* Account */}
        <SettingsGroup label={t('settings.section.account', locale)}>
          <SettingsRow
            title={t('settings.aura.title', locale)}
            description={t('settings.aura.desc', locale)}
            value={aura}
            onPress={() => router.push('/(modal)/aura')}
          />
          <SettingsRow
            title={t('settings.circle.title', locale)}
            description={t('settings.circle.desc', locale)}
            value={
              entitlement?.plan === 'monthly'
                ? t('settings.circle.monthly', locale)
                : entitlement?.plan === 'annual'
                  ? t('settings.circle.annual', locale)
                  : t('settings.circle.none', locale)
            }
            onPress={() => router.push('/(modal)/circle')}
          />
          <SettingsRow
            title={t('settings.payments.title', locale)}
            description={t('settings.payments.desc', locale)}
            onPress={() =>
              flags.fund_contributions_enabled
                ? router.push('/(modal)/payments')
                : showToast(t('settings.payments.soon', locale))
            }
          />
        </SettingsGroup>

        {/* Preferenze */}
        <SettingsGroup label={t('settings.section.prefs', locale)}>
          {/* Lingua — functional inline toggle */}
          <View className="flex-row items-center justify-between gap-4 px-5 py-4">
            <View className="flex-1 gap-1">
              <Text className="text-base text-foreground">{t('settings.lang.title', locale)}</Text>
              <Text className="text-[13px] text-faint">{t('settings.lang.desc', locale)}</Text>
            </View>
            <View
              className="flex-row gap-2"
              accessibilityRole="radiogroup"
              accessibilityLabel={t('settings.lang.title', locale)}
            >
              <Chip
                small
                label={t('lang.it', locale)}
                selected={locale === 'it'}
                onPress={() => switchLocale('it')}
              />
              <Chip
                small
                label={t('lang.en', locale)}
                selected={locale === 'en'}
                onPress={() => switchLocale('en')}
              />
            </View>
          </View>
          {/* Tema scuro — dark-only in Fase 1: display-on, non-interactive */}
          <SettingsRow
            title={t('settings.theme.title', locale)}
            description={t('settings.theme.desc', locale)}
            value={t('settings.theme.on', locale)}
            showChevron={false}
          />
          {/* Notifiche — routes to notification center (M9); presence dot, no number (rule #3) */}
          <SettingsRow
            title={t('settings.notif.title', locale)}
            description={t('settings.notif.desc', locale)}
            onPress={() => router.push('/(modal)/notifications')}
            showChevron
          />
        </SettingsGroup>

        {/* Privacy e sicurezza */}
        <SettingsGroup label={t('settings.section.privacy', locale)}>
          <SettingsRow
            title={t('settings.trust.title', locale)}
            description={t('settings.trust.desc', locale)}
            onPress={() => router.push('/(modal)/trust')}
            showChevron
          />
          <SettingsRow
            title={t('block.list.title', locale)}
            description={
              blockedCount === 0
                ? t('block.settingsRow.none', locale)
                : t('block.settingsRow.count', locale, { n: String(blockedCount) })
            }
            onPress={() => router.push('/(modal)/blocked')}
            showChevron
          />
          <SettingsRow
            title={t('report.behavior.row', locale)}
            onPress={() =>
              router.push({ pathname: '/(modal)/report', params: { targetType: 'behavior' } })
            }
            showChevron
          />
          <SettingsRow
            title={t('settings.export.title', locale)}
            description={t('settings.export.desc', locale)}
            onPress={() => router.push('/(modal)/data-export')}
            showChevron
          />
          <SettingsRow
            title={t('account.delete.row', locale)}
            danger
            onPress={() => router.push('/(modal)/delete-account')}
            showChevron
          />
        </SettingsGroup>

        {/* Supporto */}
        <SettingsGroup label={t('settings.section.support', locale)}>
          <SettingsRow
            title={t('settings.help.title', locale)}
            onPress={() => {
              Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() =>
                showToast(t('settings.help.error', locale)),
              );
            }}
          />
          <SettingsRow
            title={t('settings.legal.terms', locale)}
            onPress={() => void WebBrowser.openBrowserAsync(LEGAL_TERMS_URL)}
          />
          <SettingsRow
            title={t('settings.legal.privacy', locale)}
            onPress={() => void WebBrowser.openBrowserAsync(LEGAL_PRIVACY_URL)}
          />
          <SettingsRow
            title={t('settings.invite.title', locale)}
            description={t('settings.invite.desc', locale)}
            onPress={() => {
              // Share fires even while the code query is loading — link just omitted.
              const link = referralCode ? ` ${INVITE_URL_BASE}/${referralCode}` : '';
              Share.share({
                message: `${t('home.invite', locale)} — ${t('app.name', locale)}${link}`,
              }).catch(() => {
                // user dismissed the sheet — no-op
              });
            }}
          />
        </SettingsGroup>

        {/* Esci (danger) */}
        <SettingsGroup>
          <SettingsRow
            title={t('auth.signOut', locale)}
            danger
            showChevron={false}
            onPress={signOut}
          />
        </SettingsGroup>

        {/* Version footer */}
        <Text className="text-center text-xs text-faint">
          {t('settings.version', locale, { version })}
        </Text>
      </ScrollView>
    </Screen>
  );
}
