import { useEffect, useState, type ReactNode } from 'react';
import { Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
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
 *
 * #640 item 2: this is a MARKETING card, and it used to render the only filled CTA on
 * Home while being undismissible — outranking «Hai un Momento». The CTA is now ghost
 * (the moment surfaces keep the filled register) and the card carries a per-member
 * dismiss, remembered on this device. Dismissed → the slot collapses to nothing, like
 * every other Home block with nothing to say (#177).
 */
const DISMISSED_KEY = 'primeStelle.dismissed';

export function PrimeStelleCard({ locale, fallback }: { locale: Locale; fallback?: ReactNode }) {
  const enabled = useFeatureFlags().prime_stelle_enabled === true;
  const { showToast } = useToast();

  // Same session-gated read the InviteCard uses; only fires when the card is live.
  const { data: code, isPending } = useReferralCode(enabled);

  // null = not read yet; render nothing rather than flashing a card the member dismissed.
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(DISMISSED_KEY)
      .then((v) => alive && setDismissed(v === '1'))
      .catch(() => alive && setDismissed(false));
    return () => {
      alive = false;
    };
  }, []);

  if (!enabled) return fallback ?? null;
  if (dismissed !== false) return null;

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

  const dismiss = () => {
    setDismissed(true);
    AsyncStorage.setItem(DISMISSED_KEY, '1').catch(() => {
      // Storage refused the write: the card returns next launch, which is the benign failure.
    });
  };

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <SectionLabel>{t('prime.card.label', locale)}</SectionLabel>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close', locale)}
          hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}
          onPress={dismiss}
        >
          <Text className="text-base text-faint">✕</Text>
        </Pressable>
      </View>
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
          variant="ghost"
          disabled={isPending}
          onPress={() => void invite()}
        />
      </Card>
    </View>
  );
}
