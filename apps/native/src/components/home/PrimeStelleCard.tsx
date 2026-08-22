import type { ReactNode } from 'react';
import { Share } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { SectionLabel } from '@/components/SectionLabel';
import { useToast } from '@/components/ToastHost';
import { useFeatureFlags } from '@/hooks/use-remote-config';
import { inviteShareMessage } from '@/lib/invite-share';
import { useReferralCode } from '@/hooks/use-referral-code';

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
  const { showToast } = useToast();

  // Same session-gated read the InviteCard uses; only fires when the card is live.
  const { data: code, isPending } = useReferralCode(enabled);

  if (!enabled) return fallback ?? null;

  const invite = async () => {
    try {
      const { action } = await Share.share({
        message: inviteShareMessage({
          lead: t('prime.card.title', locale),
          appName: t('app.name', locale),
          code,
        }),
      });
      if (action === Share.sharedAction) {
        showToast(t('home.invite.done', locale), 'success');
      }
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
        <Button
          label={t('prime.card.cta', locale)}
          variant="primary"
          disabled={isPending}
          onPress={() => void invite()}
        />
      </Card>
    </View>
  );
}
