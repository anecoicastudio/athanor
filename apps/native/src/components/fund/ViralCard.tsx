import { Share } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { SectionLabel } from '@/components/SectionLabel';
import { useToast } from '@/components/ToastHost';
import { useFeatureFlags } from '@/hooks/use-remote-config';
import { inviteShareMessage } from '@/lib/invite-share';
import { useReferralCode } from '@/hooks/use-referral-code';

/**
 * «Il motore virale» — block 8 of `(modal)/annual` (FUND-SPEC §8, FUND-22 / #242).
 *
 * The three taglines are the spec's; the share CTA is the part that makes «il coinvolgimento di
 * altre persone» observable. It carries the caller's P4.1 referral link and nothing else — the
 * same URL `home/InviteCard` shares, caught by `app/invite/[code].tsx`, stashed by
 * `lib/referral.ts`, redeemed at signup by `handle_new_user()`. No new attribution path, no new
 * table, no new event: **an invite through this card yields ZERO Aura, exactly as every other
 * invite does** (rule #1 — the fund never buys score).
 *
 * FLAG-GATED, and the gate is the CTA rather than the card. The card itself has always rendered
 * off `fund_editions` alone, so gating the whole thing would change what a `fund_surfaces_enabled
 * = false` build shows today (prod's default, `supabase/seed.sql`). Gating only the new
 * affordance leaves flag-off byte-identical and follows `home/PrimeStelleCard`, which gates its
 * own referral share the same way. That the card outlives the flag is a real inconsistency, but
 * it predates #242 and hiding the copy is a product call, not this one's.
 *
 * Styling stays as it shipped: `aura-soft` + `aura-line`, no `auraGlow`. The CTA is `primary`,
 * not `light` — DESIGN §9 reserves the cyan-fill button for moment actions (accept a Momento,
 * help a dream, contribute), and sharing is not one. Rule #4 would permit a flat cyan CTA; §9 is
 * the narrower of the two, so it wins.
 */
export function ViralCard({ locale }: { locale: Locale }) {
  const shareEnabled = useFeatureFlags().fund_surfaces_enabled === true;
  const { showToast } = useToast();

  // Session-gated read, same as InviteCard/PrimeStelleCard — only fires when the CTA is live.
  const { data: code } = useReferralCode(shareEnabled);

  const share = async () => {
    try {
      // Fires even while the code query is in flight — the link is simply omitted (see
      // `lib/invite-share.ts`): an unattributed share beats a blocked one.
      const { action } = await Share.share({
        message: inviteShareMessage({
          lead: t('fund.viral.share.lead', locale),
          appName: t('app.name', locale),
          code,
        }),
      });
      if (action === Share.sharedAction) {
        showToast(t('fund.viral.share.done', locale), 'success');
      }
    } catch {
      // user dismissed or share unavailable — no-op
    }
  };

  return (
    <View className="rounded-card border border-aura-line bg-aura-soft p-5 gap-3">
      <SectionLabel tone="aura">{t('fund.viral.label', locale)}</SectionLabel>
      <Text className="text-[14px] leading-5 text-foreground">
        {t('fund.viral.tagline1', locale)}
      </Text>
      <Text className="text-[14px] leading-5 text-foreground">
        {t('fund.viral.tagline2', locale)}
      </Text>
      <Text className="text-[14px] leading-5 text-foreground">
        {t('fund.viral.tagline3', locale)}
      </Text>
      {shareEnabled ? (
        <Button
          label={t('fund.viral.share', locale)}
          accessibilityLabel={t('fund.viral.share', locale)}
          onPress={() => void share()}
        />
      ) : null}
    </View>
  );
}
