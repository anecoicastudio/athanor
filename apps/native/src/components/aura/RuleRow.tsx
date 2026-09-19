import type { ReactNode } from 'react';
import { Text, View } from '@/tw';

/**
 * One protection rule row (spec §6.2): glyph + title + desc.
 * Used in the Aura score screen to list the three integrity rules.
 *
 * `glyph` is a character or a drawing: a drawing where the character would be emoji-capable
 * (#753 — `ScalesGlyph`, not U+2696). The slot is a MINIMUM width, so the three titles align at
 * the default text size whichever kind each row carries, and a character glyph scaled up by
 * Dynamic Type widens its column instead of spilling into the title. Decorative on BOTH
 * platforms — the title beside it names the rule; `accessibilityElementsHidden` alone is iOS-only.
 */
export function RuleRow({ glyph, title, desc }: { glyph: ReactNode; title: string; desc: string }) {
  return (
    <View className="flex-row gap-3 py-2">
      <View
        className="min-w-6 items-center"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {typeof glyph === 'string' ? <Text className="text-[18px] text-aura">{glyph}</Text> : glyph}
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="text-[14px] font-semibold text-foreground">{title}</Text>
        <Text className="text-[12px] text-muted-foreground">{desc}</Text>
      </View>
    </View>
  );
}
