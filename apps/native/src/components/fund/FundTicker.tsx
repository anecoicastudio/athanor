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
 *
 * The props are a union so a caller CANNOT render figures without an open cycle (issue #224,
 * FUND-47): with `noCycle` the ticker is the announcement — «Il primo ciclo aprirà presto» on
 * a flat quiet card. No glow, no progress bar, no €0: a glowing surface means something
 * happened (rule #4), and before cycle 1 nothing has. State selection lives in
 * `lib/fund-cycle.ts` (`annualFundBody`), where it is testable.
 */
export function FundTicker(
  props:
    | { noCycle: true; locale: 'it' | 'en' }
    | {
        noCycle?: false;
        raisedCents: number;
        contributorCount: number;
        goalCents: number;
        live: boolean;
        locale: 'it' | 'en';
      },
) {
  const reduce = useReducedMotion();

  if (props.noCycle) {
    return (
      <View className="rounded-card border border-hair bg-raise p-4" accessibilityRole="none">
        <Text className="text-center text-[15px] leading-6 text-foreground">
          {t('fund.noCycle', props.locale)}
        </Text>
      </View>
    );
  }

  const { raisedCents, contributorCount, goalCents, live, locale } = props;
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
