import { Text, View } from '@/tw';

/**
 * A details-list row: a leading glyph (generic affordance) + a value line.
 * Uses text-foreground for the value (--color-ink-2 maps to text-ink-2 in Tailwind,
 * but text-ink2 is NOT defined — substituting text-foreground per task spec fallback).
 */
export function DmetaRow({ glyph, value }: { glyph: string; value: string }) {
  return (
    <View className="flex-row items-center gap-3">
      <Text className="text-[15px] text-faint">{glyph}</Text>
      <Text className="flex-1 text-[14px] text-foreground">{value}</Text>
    </View>
  );
}
