import { t, type MessageKey } from '@athanor/i18n';
import type { WeekRecap } from '@athanor/core';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View, cn } from '@/tw';
import { SectionLabel } from '@/components/SectionLabel';
import { PRESS_DIM } from '@/lib/press';

/**
 * The week recap on Home (M6 §3.4 Home block «La settimana»), in its data state: the label
 * and a hint, three figures, and the streak as a sentence. Tapping → recap sheet.
 * Read-only display — data derived from persisted ledger via summarizeWeek (rule #1).
 *
 * Bare on the stage, as the prototype draws it (#921, 2026-10-05): it was a card with a cyan
 * title, a cyan «+N» and a row of seven dots. Home's one card is the waiting Momento. The
 * week's «+N» is foreground: the cyan numeral is the member's Aura SCORE (DESIGN §2.3), and
 * this is a week's gain. The dots are gone with the card; the sentence says the streak.
 *
 * `home/WeekSlot` is the only caller and owns the other three states.
 */
export function WeekCard({
  recap,
  locale,
  onPress,
}: {
  recap: WeekRecap;
  locale: Locale;
  onPress: () => void;
}) {
  const stats = [
    {
      key: 'aura',
      figure: `+${recap.auraWeek}`,
      label: t('recap.metric.aura' as MessageKey, locale),
    },
    {
      key: 'contributi',
      figure: String(recap.contributi),
      label: t('recap.card.contributi' as MessageKey, locale),
    },
    {
      key: 'dreams',
      figure: String(recap.sogniAiutati),
      label: t('recap.card.dreams' as MessageKey, locale),
    },
  ];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('recap.weekTitle' as MessageKey, locale)}
      onPress={onPress}
      className={cn('gap-2', PRESS_DIM)}
    >
      <View className="flex-row flex-wrap items-center justify-between gap-x-3">
        <SectionLabel>{t('recap.weekTitle' as MessageKey, locale)}</SectionLabel>
        <Text className="type-small text-muted-foreground">
          {t('recap.weekHint' as MessageKey, locale)}
        </Text>
      </View>

      {/* Three figures, each over its word, left-aligned. `flex-wrap`: at the largest sizes
          three columns do not fit one line, and a column drops under the others. */}
      <View className="flex-row flex-wrap items-start justify-between gap-x-3 gap-y-2">
        {stats.map(({ key, figure, label }) => (
          <View key={key} className="gap-1">
            <Text className="type-num-m text-foreground">{figure}</Text>
            <Text className="type-small text-muted-foreground">{label}</Text>
          </View>
        ))}
      </View>

      <Text className="type-small text-muted-foreground">
        {t('recap.streak' as MessageKey, locale, { n: recap.streakDays })}
      </Text>
    </Pressable>
  );
}
