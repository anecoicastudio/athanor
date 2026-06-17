import { t, type MessageKey } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { tierOf } from '@athanor/core';
import { Text, View } from '@/tw';

/** «AURA {value} · {tierName}» pill. Tokens: `aura-line` border, `aura-soft` bg. */
export function TierChip({ value, locale }: { value: number; locale: Locale }) {
  const tierName = t(`tier.${tierOf(value)}` as MessageKey, locale);
  return (
    <View className="self-start rounded-full border border-aura-line bg-aura-soft px-3 py-1">
      <Text className="text-[12px] text-aura" style={{ fontVariant: ['tabular-nums'] }}>
        {t('aura.unit', locale)} {value} · {tierName}
      </Text>
    </View>
  );
}
