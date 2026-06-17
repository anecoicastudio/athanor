import { Text, View } from '@/tw';
import { ProgressBar } from '@/components/ProgressBar';
import type { NextStar } from '@athanor/core';
import { t, type MessageKey } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';

/**
 * Next-star progress strip — own profile only.
 * Shows the closest unearned star (by progress ratio) + a progress bar + hint.
 * Returns null when `next` is null (all earned or engine dormant → no rows).
 */
export function StarProgress({ next, locale }: { next: NextStar | null; locale: Locale }) {
  if (next == null) return null;

  const starName = t(`star.${next.starId}` as MessageKey, locale);
  const unit = t(`star.unit.${next.unit}` as MessageKey, locale);
  const width = next.total > 0 ? next.done / next.total : 0;

  return (
    <View className="gap-2 rounded-card border border-hair bg-raise px-4 py-3">
      <Text className="text-[13px] font-semibold text-foreground">
        {t('star.next.title', locale, { star: starName })}
      </Text>
      <Text className="text-[12px] text-faint">
        {t('star.next.progress', locale, { done: next.done, total: next.total, unit })}
      </Text>
      <ProgressBar width={width} />
      <Text className="text-[11px] text-muted-foreground">{t('star.next.hint', locale)}</Text>
    </View>
  );
}
