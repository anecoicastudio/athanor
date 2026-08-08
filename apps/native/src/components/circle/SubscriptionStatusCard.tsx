import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { Tag } from '@/components/Tag';
import { auraGlow } from '@/lib/glow';

/**
 * Subscription status card for confirmed Circle members (M8 §3.3).
 * Rendered ONLY when isMember=true; the parent screen guards this.
 *
 * Moment glow: rule #4 — «you belong» is moment-grade. Surface uses bg-aura-soft +
 * border-aura-line + auraGlow(1) (same recipe as the fund viral card + match overlay).
 * Reduced-motion: opacity-in only, no transform — mirrors level.tsx / candidacy-success.tsx
 * pattern (AccessibilityInfo.isReduceMotionEnabled).
 *
 * Check glyph ✓ from MilestoneRow pattern; plan/renewal via i18n keys; founding → cosmetic Tag
 * badge. past_due renders BELOW the glowing card, not inside it — see the comment at that line.
 */
export function SubscriptionStatusCard({
  plan,
  status,
  currentPeriodEnd,
  founding,
  locale,
}: {
  plan: 'monthly' | 'annual' | null;
  status: 'active' | 'past_due' | 'canceled' | 'incomplete' | null;
  currentPeriodEnd: string | null;
  founding: boolean;
  locale: Locale;
}) {
  const reduceMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!reduceMotion) {
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    }
  }, [reduceMotion, opacity]);

  const isPastDue = status === 'past_due';

  const planLabel =
    plan === 'monthly'
      ? t('circle.member.planMonthly', locale)
      : plan === 'annual'
        ? t('circle.member.planAnnual', locale)
        : null;

  const renewalDate = currentPeriodEnd
    ? new Intl.DateTimeFormat(locale === 'it' ? 'it-IT' : 'en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(new Date(currentPeriodEnd))
    : null;

  return (
    <Animated.View style={reduceMotion ? { opacity: 1 } : { opacity }}>
      {/* Moment-grade surface: bg-aura-soft + border-aura-line + auraGlow(1) — rule #4 */}
      <View
        className="rounded-card border border-aura-line bg-aura-soft p-5 gap-4"
        style={auraGlow(1)}
      >
        {/* Header row */}
        <View className="flex-row items-center gap-2">
          <Text className="text-aura text-base">✓</Text>
          <Text className="flex-1 text-[18px] font-bold text-foreground">
            {t('circle.member.title', locale)}
          </Text>
          {founding ? <Tag label={t('circle.member.foundingBadge', locale)} /> : null}
        </View>

        {/* Plan line */}
        {planLabel ? <Text className="text-[14px] text-muted-foreground">{planLabel}</Text> : null}

        {/* Renewal line */}
        {renewalDate && !isPastDue ? (
          <Text className="text-[13px] text-muted-foreground">
            {t('circle.member.renews', locale, { date: renewalDate })}
          </Text>
        ) : null}
      </View>

      {/* Past-due warning — OUTSIDE the glow card, deliberately. Two reasons, one move.
          Contrast: on `bg-aura-soft` this 13px `error` was 4.26:1, under the floor; on the
          modal's `bg-background` it is 4.93:1. Meaning: the aura-soft + aura-line + auraGlow(1)
          recipe is what rule #4 reserves for moment-grade good news («you belong») — a failed
          payment inside it had the surface contradicting the text.
          Still open, not decided here: whether the card should glow AT ALL while past-due. */}
      {isPastDue ? (
        <Text className="mt-3 text-[13px] text-error">{t('circle.member.pastDue', locale)}</Text>
      ) : null}
    </Animated.View>
  );
}
