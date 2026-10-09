import { Text, View } from '@/tw';
import { ProgressBar } from '@/components/ProgressBar';
import { SectionLabel } from '@/components/SectionLabel';
import type { NextStar } from '@athanor/core';
import { t, type MessageKey } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';

/**
 * Next-star progress — own profile only, a bare block under the six stars (a bordered card
 * until 2026-10-05: the profile's one card is the dream, DESIGN §6).
 * Shows the closest unearned star (by progress ratio) + a progress bar + hint.
 * Returns null when `next` is null (all earned or engine dormant → no rows).
 */
export function StarProgress({ next, locale }: { next: NextStar | null; locale: Locale }) {
  if (next == null) return null;

  const starName = t(`star.${next.starId}` as MessageKey, locale);
  const unit = t(`star.unit.${next.unit}` as MessageKey, locale);
  const width = next.total > 0 ? next.done / next.total : 0;

  return (
    <View className="gap-2">
      <SectionLabel>{t('star.next.title', locale, { star: starName })}</SectionLabel>
      <Text className="type-small text-foreground">
        {t('star.next.progress', locale, { done: next.done, total: next.total, unit })}
      </Text>
      <ProgressBar width={width} />
      <Text className="type-small text-muted-foreground">{t('star.next.hint', locale)}</Text>
    </View>
  );
}
