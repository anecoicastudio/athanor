import { View } from '@/tw';

/**
 * The outline mandorla (DESIGN §5 «On mobile»): two overlapping hairline circles in the
 * secondary grey — no fill, no gradient, no glow. It heads an empty, an error and a loading
 * state. Decoration: hidden from assistive tech, and it does not grow with the text size.
 *
 * Not `Mandorla`, which is the vertical lens drawn AROUND something (an avatar, a ✦).
 */
export function MandorlaMark() {
  return (
    <View
      className="w-[124px] flex-row"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* 96 + 96 − 68 of overlap = the 124 of the box: each circle passes near the other's centre. */}
      <View className="size-24 rounded-full border border-muted-foreground" />
      <View className="-ml-[68px] size-24 rounded-full border border-muted-foreground" />
    </View>
  );
}
