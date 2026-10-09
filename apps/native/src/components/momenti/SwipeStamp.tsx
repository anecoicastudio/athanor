import { Animated } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Text, View, cn } from '@/tw';

/**
 * Absolutely-positioned YES/NO stamp (frontend §9). Opacity is driven by the deck's
 * drag Animated value (clamped ±dx/threshold). YES = «Connetti ✦» in foreground, NO = «Passa»
 * in the secondary grey: the two pills under the deck, white and outline, said again on the
 * card (Marco, 2026-10-05, #921). No green on mobile, and passing is not an error, so no red.
 * A pill with a 2px line, tilted. The prototype draws no stamp. pointerEvents none so it never
 * eats the drag.
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
    <View pointerEvents="none" className={cn('absolute top-6', isYes ? 'left-6' : 'right-6')}>
      <Animated.View style={{ opacity, transform: [{ rotate: isYes ? '-12deg' : '12deg' }] }}>
        <View
          className={cn(
            'rounded-full border-2 bg-surface px-[14px] py-1',
            isYes ? 'border-foreground' : 'border-muted-foreground',
          )}
        >
          <Text
            className={cn(
              'type-body font-semibold',
              isYes ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {isYes ? t('momenti.connect', locale) : t('momenti.pass', locale)}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}
