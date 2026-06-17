import { t, type MessageKey } from '@athanor/i18n';
import type { WeekRecap } from '@athanor/core';
import type { Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { SectionLabel } from '@/components/SectionLabel';
import { Card } from '@/components/Card';

/**
 * Compact week-recap card (M6 §3.4 Home block «La settimana»).
 * Shows spread header + 3 stats + 7-dot streak. Tapping → recap sheet.
 * Read-only display — data derived from persisted ledger via summarizeWeek (rule #1).
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
  const dots = Array.from({ length: 7 }, (_, i) => i < recap.streakDays);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('recap.weekTitle' as MessageKey, locale)}
      onPress={onPress}
      className="gap-3"
    >
      {/* Section label row */}
      <View className="flex-row items-center justify-between">
        <SectionLabel>{t('recap.weekTitle' as MessageKey, locale)}</SectionLabel>
        <Text className="text-[12px] text-muted-foreground">
          {t('recap.weekHint' as MessageKey, locale)}
        </Text>
      </View>

      <Card>
        {/* 3 stats row */}
        <View className="flex-row justify-between">
          {/* Aura week */}
          <View className="items-center gap-1">
            <Text
              className="text-[22px] font-extrabold text-aura"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              +{recap.auraWeek}
            </Text>
            <Text className="text-[11px] text-muted-foreground">
              {t('recap.metric.aura' as MessageKey, locale)}
            </Text>
          </View>

          {/* Contributi */}
          <View className="items-center gap-1">
            <Text
              className="text-[22px] font-extrabold text-foreground"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {recap.contributi}
            </Text>
            <Text className="text-[11px] text-muted-foreground">
              {t('recap.card.contributi' as MessageKey, locale)}
            </Text>
          </View>

          {/* Sogni aiutati */}
          <View className="items-center gap-1">
            <Text
              className="text-[22px] font-extrabold text-foreground"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {recap.sogniAiutati}
            </Text>
            <Text className="text-[11px] text-muted-foreground">
              {t('recap.card.dreams' as MessageKey, locale)}
            </Text>
          </View>
        </View>

        {/* 7-dot streak row */}
        <View className="flex-row items-center gap-3">
          <View className="flex-row gap-[5px]">
            {dots.map((lit, i) => (
              <View key={i} className={`h-2 w-2 rounded-full ${lit ? 'bg-aura' : 'bg-raise'}`} />
            ))}
          </View>
          <Text className="text-[12px] text-muted-foreground">
            {t('recap.streak' as MessageKey, locale, { n: recap.streakDays })}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}
