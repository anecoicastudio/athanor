import { formatFundTotal } from '@athanor/core';
import { t } from '@athanor/i18n';
import { Text, View } from '@/tw';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { auraGlow } from '@/lib/glow';
import { ProgressBar } from '@/components/ProgressBar';

/**
 * Live fund ticker — progress bar + glowing raised total + contributor count.
 * The fund total + contributor count are public by design (rule #3 — heartbeat, not vanity).
 * The total surface is a sanctioned glow (rule #4 — live fund ticker).
 * Live dot pulse is suppressed to a static dot under reduce-motion.
 */
export function FundTicker({
  raisedCents,
  contributorCount,
  goalCents,
  live,
  locale,
}: {
  raisedCents: number;
  contributorCount: number;
  goalCents: number;
  live: boolean;
  locale: 'it' | 'en';
}) {
  const reduce = useReducedMotion();

  const progress = goalCents > 0 ? raisedCents / goalCents : 0;
  const totalLabel = formatFundTotal(raisedCents, locale);
  const liveText = live ? t('fund.live.label', locale) : t('fund.live.paused', locale);

  return (
    <View
      className="rounded-card border border-aura-line bg-aura-soft p-4 gap-3"
      style={auraGlow(1)}
      accessibilityRole="none"
    >
      {/* Progress bar */}
      <ProgressBar width={progress} />

      {/* Spread row: left = total + live status; right = contributor count */}
      <View className="flex-row items-start justify-between">
        {/* Left: glowing total + live/paused indicator */}
        <View className="gap-1">
          <Text
            className="text-2xl font-extrabold text-aura"
            style={{ fontVariant: ['tabular-nums'] }}
            accessibilityRole="text"
            accessibilityLabel={totalLabel}
          >
            {totalLabel}
          </Text>
          <View className="flex-row items-center gap-1.5">
            {/* Live dot — static under reduce-motion, implicit pulse hint visually for full motion */}
            <View
              className={`h-2 w-2 rounded-full ${live ? 'bg-aura' : 'bg-muted-foreground'}`}
              style={live && !reduce ? auraGlow(0.6) : undefined}
            />
            <Text className="text-xs text-muted-foreground">{liveText}</Text>
          </View>
        </View>

        {/* Right: contributor count + label */}
        <View className="items-end gap-0.5">
          <Text
            className="text-2xl font-extrabold text-foreground"
            style={{ fontVariant: ['tabular-nums'] }}
            accessibilityRole="text"
          >
            {contributorCount}
          </Text>
          <Text className="text-xs text-muted-foreground">{t('fund.people.label', locale)}</Text>
        </View>
      </View>
    </View>
  );
}
