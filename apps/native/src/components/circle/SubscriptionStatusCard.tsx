import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Text, View } from '@/tw';
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
 * Check glyph ✓ from MilestoneRow pattern; plan/renewal via i18n keys; past_due → error
 * tint; founding → cosmetic Tag badge.
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
  const [reduceMotion, setReduceMotion] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => setReduceMotion(false));
  }, []);

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

        {/* Past-due warning */}
        {isPastDue ? (
          <Text className="text-[13px] text-error">{t('circle.member.pastDue', locale)}</Text>
        ) : null}
      </View>
    </Animated.View>
  );
}
