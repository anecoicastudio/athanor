import { useState } from 'react';
import { Share } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text } from '@/tw';

/**
 * Invite card (PRD 01-m1-identity §3.2, block 8) — M1 owns it. Opens the native
 * share sheet with an invite line; tracked-referral attribution (Ambasciatore
 * star) is deferred to a later milestone, so this just shares copy + the app.
 */
export function InviteCard({ locale }: { locale: Locale }) {
  const [sent, setSent] = useState(false);

  const invite = async () => {
    try {
      const { action } = await Share.share({
        message: `${t('home.invite', locale)} — ${t('app.name', locale)}`,
      });
      if (action === Share.sharedAction) {
        setSent(true);
        setTimeout(() => setSent(false), 2500);
      }
    } catch {
      // user dismissed or share unavailable — no-op
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('home.invite', locale)}
      onPress={invite}
      className="flex-row items-center gap-3 rounded-card border border-hair bg-raise p-4 min-h-[56px]"
    >
      <Text className="text-lg text-aura">✦</Text>
      <Text className="flex-1 text-sm font-medium text-foreground">
        {sent ? t('home.invite.sent', locale) : t('home.invite', locale)}
      </Text>
    </Pressable>
  );
}
