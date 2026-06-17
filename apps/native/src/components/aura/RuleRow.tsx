import { Text, View } from '@/tw';

/**
 * One protection rule row (spec §6.2): glyph + title + desc.
 * Used in the Aura score screen to list the three integrity rules.
 */
export function RuleRow({ glyph, title, desc }: { glyph: string; title: string; desc: string }) {
  return (
    <View className="flex-row gap-3 py-2">
      <Text className="text-[18px] text-aura" accessibilityElementsHidden>
        {glyph}
      </Text>
      <View className="flex-1 gap-0.5">
        <Text className="text-[14px] font-semibold text-ink">{title}</Text>
        <Text className="text-[12px] text-muted">{desc}</Text>
      </View>
    </View>
  );
}
