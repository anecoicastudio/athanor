import { useEffect, useState } from 'react';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { blockKeys, getAuraScore, getBlockedCount, updateProfile } from '@athanor/api';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { Chip } from '@/components/Chip';
import { SettingsGroup } from '@/components/SettingsGroup';
import { SettingsRow } from '@/components/SettingsRow';
import { useAuth } from '@/lib/auth-context';
import { useEntitlement } from '@/lib/useEntitlement';
import { supabase } from '@/lib/supabase';
import { MODAL_A11Y } from '@/lib/a11y';

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

  const [toast, setToast] = useState<string | null>(null);
  const [aura, setAura] = useState(0);
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

  // Read-only Aura snapshot (M1 always zero; M6 score-engine fills real values).
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;
    let cancelled = false;
    getAuraScore(supabase, userId)
      .then((a) => {
        if (!cancelled) setAura(a.score);
      })
      .catch(() => {
        // zero is the safe fallback
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const switchLocale = async (next: Locale) => {
    const userId = session?.user.id;
    if (!userId || next === locale || langBusy) return;
    setLangBusy(true);
    try {
      await updateProfile(supabase, userId, { locale: next });
      await refreshProfile();
      showToast(t(next === 'it' ? 'settings.lang.it' : 'settings.lang.en', next));
    } catch {
      showToast(t('profile.error', locale));
    } finally {
      setLangBusy(false);
    }
  };

  const signOut = () => {
    if (signingOut) return;
    setSigningOut(true);
    showToast(t('settings.logout.toast', locale));
    // Brief farewell, then end the session — AuthGuard routes to (auth)/welcome.
    setTimeout(() => {
      supabase.auth.signOut().catch(() => setSigningOut(false));
    }, 700);
  };

  return (
    <ScrollView
      {...MODAL_A11Y}
      className="flex-1 bg-background"
      contentContainerClassName="gap-7 px-5 py-12"
    >
      {/* Header: back + title */}
      <View className="flex-row items-center gap-4">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', locale)}
          hitSlop={8}
        >
          <Text className="text-2xl text-foreground">‹</Text>
        </Pressable>
        <Text accessibilityRole="header" className="text-xl font-semibold text-foreground">
          {t('settings.title', locale)}
        </Text>
      </View>

      {/* Account card */}
      <View className="flex-row items-center gap-4 rounded-card border border-hair bg-raise p-5">
        <Avatar handle={profile?.handle ?? null} size={56} />
        <View className="flex-1 gap-1">
          <Text className="text-lg font-semibold text-foreground">{profile?.handle ?? '—'}</Text>
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
          value={String(aura)}
          onPress={() => showToast(t('settings.soon', locale))}
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
          onPress={() => showToast(t('settings.payments.soon', locale))}
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
          onPress={() => showToast(t('settings.soon', locale))}
        />
        <SettingsRow
          title={t('settings.legal.title', locale)}
          onPress={() => showToast(t('settings.soon', locale))}
        />
        <SettingsRow
          title={t('settings.invite.title', locale)}
          description={t('settings.invite.desc', locale)}
          onPress={() => showToast(t('settings.soon', locale))}
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

      {toast ? (
        <View className="absolute inset-x-5 bottom-10 items-center rounded-card border border-hair bg-raise-2 px-5 py-3">
          <Text className="text-sm text-foreground">{toast}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
