import { FUND_SPLIT } from '@athanor/core';
import { t } from '@athanor/i18n';
import { Text, View } from '@/tw';

/**
 * 90/10 fund split bar — left segment (dreams, bg-aura) + right segment (ops, bg-raise).
 * Proportions driven by FUND_SPLIT named constants (rule #10 — no scattered literals).
 */
export function SplitBar({ locale }: { locale: 'it' | 'en' }) {
  return (
    <View className="gap-2">
      {/* The bar itself */}
      <View className="h-3 flex-row overflow-hidden rounded-full">
        <View className="h-full rounded-l-full bg-aura" style={{ flex: FUND_SPLIT.dreamPct }} />
        <View className="h-full rounded-r-full bg-raise" style={{ flex: FUND_SPLIT.opsPct }} />
      </View>

      {/* Segment labels */}
      <View className="flex-row justify-between">
        <Text className="text-xs font-medium text-aura">{t('fund.split.dream', locale)}</Text>
        <Text className="text-xs text-muted-foreground">{t('fund.split.ops', locale)}</Text>
      </View>
    </View>
  );
}
