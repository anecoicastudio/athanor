import { Animated } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Text, View } from '@/tw';

/**
 * Absolutely-positioned YES/NO stamp (frontend §9). Opacity is driven by the deck's
 * drag Animated value (clamped ±dx/threshold). YES = «Connetti ✦» in success green,
 * NO = «Passa» in error red. Flat colors — the glow is reserved for the match overlay
 * (rule #4). pointerEvents none so it never eats the drag.
 *
 * No className on Animated.* — the @/tw wrappers don't cover Animated, so classes live
 * on @/tw children (see BrandSplash). The static tilt is applied via the transform
 * style (no rotate Tailwind precedent in the app).
 */
export function SwipeStamp({
  kind,
  opacity,
  locale,
}: {
  kind: 'yes' | 'no';
  opacity: Animated.AnimatedInterpolation<number> | Animated.Value;
  locale: Locale;
}) {
  const isYes = kind === 'yes';
  return (
    <View pointerEvents="none" className={`absolute top-6 ${isYes ? 'left-6' : 'right-6'}`}>
      <Animated.View style={{ opacity, transform: [{ rotate: isYes ? '-12deg' : '12deg' }] }}>
        <View
          className={`rounded-lg border-2 px-3 py-1 ${isYes ? 'border-success' : 'border-error'}`}
        >
          <Text className={`text-base font-semibold ${isYes ? 'text-success' : 'text-error'}`}>
            {isYes ? t('momenti.connect', locale) : t('momenti.pass', locale)}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}
