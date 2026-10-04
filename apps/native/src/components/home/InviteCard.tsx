import { useState } from 'react';
import { Share } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Row } from '@/components/Row';
import { inviteShareMessage } from '@/lib/invite-share';
import { useReferralCode } from '@/hooks/use-referral-code';

/**
 * Invite card (PRD 01-m1-identity §3.2, block 8) — M1 owns it. Opens the native
 * share sheet with an invite line; P4.1 appends the caller's personal referral
 * link so activation can be attributed (Ambasciatore star).
 *
 * One `Row`, the second of the group Home ends on (#921, 2026-10-05): it was a bordered card
 * with a cyan ✦. The ✦ leads the title now, in the title's own colour. The file keeps its name.
 */
export function InviteCard({ locale }: { locale: Locale }) {
  const [sent, setSent] = useState(false);

  // Component only renders authed (Home), so the session-gated query is always live.
  const { data: code } = useReferralCode();

  const invite = async () => {
    try {
      const { action } = await Share.share({
        message: inviteShareMessage({
          lead: t('home.invite', locale),
          appName: t('app.name', locale),
          code,
        }),
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
    <Row
      title={sent ? t('home.invite.sent', locale) : `✦ ${t('home.invite', locale)}`}
      accessibilityLabel={t('home.invite', locale)}
      onPress={invite}
    />
  );
}
