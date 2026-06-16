import { Animated } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';

/**
 * Absolutely-positioned YES/NO stamp (frontend §9). Opacity is driven by the deck's
 * drag Animated value (clamped ±dx/threshold). YES = «Connetti ✦» in success green,
 * NO = «Passa» in error red. Flat colors — the glow is reserved for the match overlay
 * (rule #4). pointerEvents none so it never eats the drag.
 *
 * Animated.View accepts NativeWind className via the react-native-css interop in this
 * repo (same pattern as StoriesViewer / MomentFlash). The static tilt is applied via
 * the transform style (no rotate Tailwind precedent in the app).
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
    <Animated.View
      pointerEvents="none"
      style={{ opacity, transform: [{ rotate: isYes ? '-12deg' : '12deg' }] }}
      className={`absolute top-6 rounded-lg border-2 px-3 py-1 ${
        isYes ? 'left-6 border-success' : 'right-6 border-error'
      }`}
    >
      <Animated.Text className={`text-base font-semibold ${isYes ? 'text-success' : 'text-error'}`}>
        {isYes ? t('momenti.connect', locale) : t('momenti.pass', locale)}
      </Animated.Text>
    </Animated.View>
  );
}
