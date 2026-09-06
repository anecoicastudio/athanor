import { semantic } from '@athanor/config';
import { t, type MessageKey } from '@athanor/i18n';
import type { Locale, ZodiacSign } from '@athanor/schemas';
import { View } from '@/tw';
import { ZodiacGlyph } from '@/components/glyphs';

/**
 * The sun-sign glyph beside the display name (#694). Cosmetic/granted register, like
 * `FoundingBadge`: `ink2`, never `aura`, NEVER glowing (rule #4) — a sign is something you were
 * born under, not something that happened here. Profile header only.
 *
 * Accessibility: the drawing is silent (both hide props — iOS and Android each honour one,
 * #635) and the wrapper is the image, labelled «segno zodiacale Leone» rather than a bare
 * «Leone» — read straight after «Marco», a bare sign name is heard as a surname.
 */
export function ZodiacMark({
  sign,
  locale,
  size = 20,
}: {
  sign: ZodiacSign;
  locale: Locale;
  size?: number;
}) {
  const name = t(`zodiac.${sign}` as MessageKey, locale);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('profile.zodiac.a11y', locale, { sign: name })}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <ZodiacGlyph sign={sign} size={size} color={semantic.ink2} />
      </View>
    </View>
  );
}
