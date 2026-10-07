import { Text, View } from '@/tw';
import { MandorlaMark } from '@/components/MandorlaMark';
import { FONT_SCALE_CAP } from '@/lib/type-scale';

/**
 * The mark of a celebration screen (DESIGN §5 «On mobile», §2.3, §8.12): the outline mandorla
 * with a ✦ in `aura` at its centre. One of the five places cyan stands on mobile, so it is
 * drawn on the celebration screens and nowhere else (match, new level, favour done, candidacy
 * sent, contribution thanks); `source-audit.test.ts` holds that list. An empty, an error and a
 * loading state draw `MandorlaMark` alone, with nothing at its centre.
 *
 * A component of its own (Marco, 2026-10-07) so that `MandorlaMark` stays free of cyan and the
 * five screens share one drawing. Decoration: hidden from assistive tech, like the mark it wraps.
 */
export function CelebrationMark() {
  return (
    <View
      className="items-center justify-center"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <MandorlaMark />
      {/* `ornament` (DESIGN §10): the ✦ sits inside a mark whose size is a layout constant, so
          it does not grow with the text size either. */}
      <Text
        className="absolute text-[22px] text-aura"
        maxFontSizeMultiplier={FONT_SCALE_CAP.ornament}
      >
        ✦
      </Text>
    </View>
  );
}
