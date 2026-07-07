import type { ReactNode } from 'react';
import { Share } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { getMyReferralCode, inviteKeys } from '@athanor/api';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { SectionLabel } from '@/components/SectionLabel';
import { useFeatureFlags } from '@/lib/useRemoteConfig';
import { INVITE_URL_BASE } from '@/lib/links';
import { supabase } from '@/lib/supabase';

/**
 * «Le Prime Stelle» — founding-cohort launch card (frontend 10 §3.6 PS-4/PS-5),
 * Home Esplora slot. Gated by remote_config.prime_stelle_enabled so it can be
 * retired post-launch without an app release; renders `fallback` when off.
 * CTA = the invite/apply flow: shares the caller's personal referral link
 * (PS-1 — founding invites reuse the P4.1 referral mechanism).
 * PS-5 (rule #1): copy states the zero-score guarantee (`prime.note`);
 * flat styling only — no glow (rule #4: nothing "happened" here).
 */
export function PrimeStelleCard({ locale, fallback }: { locale: Locale; fallback?: ReactNode }) {
  const enabled = useFeatureFlags().prime_stelle_enabled === true;

  // Same session-gated read the InviteCard uses; only fires when the card is live.
  const { data: code } = useQuery({
    queryKey: inviteKeys.code(),
    queryFn: () => getMyReferralCode(supabase),
    enabled,
  });

  if (!enabled) return fallback ?? null;

  const invite = async () => {
    try {
      const link = code ? ` ${INVITE_URL_BASE}/${code}` : '';
      await Share.share({
        message: `${t('prime.card.title', locale)} — ${t('app.name', locale)}${link}`,
      });
    } catch {
      // user dismissed or share unavailable — no-op
    }
  };

  return (
    <View className="gap-3">
      <SectionLabel>{t('prime.card.label', locale)}</SectionLabel>
      <Card>
        <Text className="text-lg font-semibold text-foreground">
          {t('prime.card.title', locale)}
        </Text>
        <Text className="text-sm leading-5 text-muted-foreground">
          {t('prime.card.body', locale)}
        </Text>
        <Text className="text-xs italic text-faint">{t('prime.note', locale)}</Text>
        <Button label={t('prime.card.cta', locale)} variant="primary" onPress={() => void invite()} />
      </Card>
    </View>
  );
}
