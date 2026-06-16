import { Text, View } from '@/tw';

/**
 * A details-list row: a leading glyph (generic affordance) + a value line.
 * Value uses text-ink-2 (the softer body token, --color-ink-2) — the correct
 * Tailwind 4 class is hyphenated `text-ink-2`, not `text-ink2`.
 */
export function DmetaRow({ glyph, value }: { glyph: string; value: string }) {
  return (
    <View className="flex-row items-center gap-3">
      <Text className="text-[15px] text-faint">{glyph}</Text>
      <Text className="flex-1 text-[14px] text-ink-2">{value}</Text>
    </View>
  );
}
