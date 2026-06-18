import type { Locale } from '@athanor/schemas';
import { t } from '@athanor/i18n';
import { Text, View } from '@/tw';
import { ProgressBar } from '@/components/ProgressBar';

/**
 * Read-only consensus bar for a candidate (M7 §3.2). A thin wrapper over
 * `ProgressBar` that shows the server-computed consensus `percent` (0–100) and
 * its label «{pct}% di consensi». DISPLAY ONLY — it never computes weighting
 * (that lives in `@athanor/core`). No glow: a vote bar is not a moment-grade
 * surface (rule #4). The % numeral is tabular so values don't jitter.
 */
export function VoteBar({ percent, locale }: { percent: number; locale: Locale }) {
  const pct = Math.round(Math.min(100, Math.max(0, percent)));
  return (
    <View className="gap-1.5">
      <ProgressBar width={pct / 100} />
      <Text className="text-[12px] text-muted-foreground tabular-nums">
        {t('fund.vote.consensus', locale, { pct })}
      </Text>
    </View>
  );
}
