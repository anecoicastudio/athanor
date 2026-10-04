import { useEffect, useState } from 'react';
import { Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View, cn } from '@/tw';
import { HeaderClose } from '@/components/ModalHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { useToast } from '@/components/ToastHost';
import { useFeatureFlags } from '@/hooks/use-remote-config';
import { inviteShareMessage } from '@/lib/invite-share';
import { PRESS_DIM } from '@/lib/press';
import { useReferralCode } from '@/hooks/use-referral-code';

/**
 * «Le Prime Stelle» — founding-cohort launch card (frontend 10 §3.6 PS-4/PS-5),
 * Home Esplora slot. Gated by remote_config.prime_stelle_enabled so it can be
 * retired post-launch without an app release; renders NOTHING when off — the slot used to
 * fall back to a «Presto qui» card, which put "Coming soon" on production Home while the
 * flag was off (#749, ruled 2026-09-18: no placeholder at launch).
 * CTA = the invite/apply flow: shares the caller's personal referral link
 * (PS-1 — founding invites reuse the P4.1 referral mechanism).
 * PS-5 (rule #1): copy states the zero-score guarantee (`prime.note`).
 *
 * Not a card since 2026-10-05 (#921; Marco that day: the blocks the prototype does not draw
 * are borderless too): the label with the drawn close at its right, then a title, the body,
 * the note and a link, on the stage. The file keeps its name.
 *
 * #640 item 2: this is a MARKETING card, and it used to render the only filled CTA on
 * Home while being undismissible — outranking «Hai un Momento». The CTA is now a link
 * (the moment surfaces keep the filled register) — hand-rolled with the `ghost` link's
 * classes, because `Button ghost` centres its words and this one stands on the gutter — and
 * the block carries a per-member dismiss, remembered on this device. Dismissed → the slot collapses to nothing, like
 * every other Home block with nothing to say (#177).
 */
const DISMISSED_KEY = 'primeStelle.dismissed';

export function PrimeStelleCard({ locale }: { locale: Locale }) {
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

  if (!enabled) return null;
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
    <View className="gap-2">
      <View className="flex-row items-center justify-between gap-2">
        {/* `flex-1`: the label takes the width the close leaves, so its words are never
            measured to fit (see `aura/WeekCard`). */}
        <SectionLabel className="flex-1">{t('prime.card.label', locale)}</SectionLabel>
        <HeaderClose label={t('common.close', locale)} onPress={dismiss} />
      </View>
      <Text className="type-h2 text-foreground">{t('prime.card.title', locale)}</Text>
      <Text className="type-small text-muted-foreground">{t('prime.card.body', locale)}</Text>
      <Text className="type-small italic text-muted-foreground">{t('prime.note', locale)}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isPending }}
        disabled={isPending}
        onPress={() => void invite()}
        className={cn(
          'min-h-[44px] justify-center self-start',
          PRESS_DIM,
          isPending && 'opacity-40',
        )}
      >
        <Text className="type-small text-foreground underline">{t('prime.card.cta', locale)}</Text>
      </Pressable>
    </View>
  );
}
