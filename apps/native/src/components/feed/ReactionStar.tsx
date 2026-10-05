import { useEffect } from 'react';
import { Animated, Easing } from 'react-native';
import { type Locale, t } from '@athanor/i18n';
import { Pressable, Text, cn } from '@/tw';
import { PRESS_DIM } from '@/lib/press';
import { useAnimatedValue } from '@/hooks/use-animated-value';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { star } from '@/lib/star';

/**
 * The single "light a star" (frontend §3.2). VIEWER-STATE-ONLY — never renders a
 * count to anyone (rule #3). lit = filled ✦ in the foreground + burst (scale 1→1.15→1,
 * ~380ms); unlit = outline ✧ in the secondary grey; pending dims; disabled = your own post.
 * Never `aura`: a lit star is not one of the five cyan marks (DESIGN §2.3, §9 «Reaction ✦»).
 *
 * SHAPE carries the state, not colour alone: an assertive unlit star is exactly what rule #3
 * doesn't want. ✦/✧ is the app's existing unlit vocabulary (the six stars' rows, `SixStarsGrid`).
 * Reduced-motion → opacity cut, no transform (frontend §9; MomentFlash pattern).
 */
export function ReactionStar({
  lit,
  pending = false,
  disabled = false,
  onPress,
  locale,
}: {
  lit: boolean;
  pending?: boolean;
  disabled?: boolean;
  onPress: () => void;
  locale: Locale;
}) {
  const reduceMotion = useReducedMotion();
  const scale = useAnimatedValue(1);

  useEffect(() => {
    if (!lit || reduceMotion) return;
    scale.setValue(1);
    Animated.sequence([
      Animated.timing(scale, {
        toValue: 1.15,
        duration: 160,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 220,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [lit, reduceMotion, scale]);

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled || pending}
      accessibilityRole="button"
      accessibilityState={{ selected: lit, disabled: disabled || pending }}
      accessibilityLabel={t(lit ? 'post.react.a11yLit' : 'post.react.a11y', locale)}
      className={cn('min-h-[44px] min-w-[44px] flex-row items-center justify-center', PRESS_DIM)}
    >
      <Animated.View
        style={{
          transform: reduceMotion ? undefined : [{ scale }],
          opacity: pending ? 0.5 : 1,
        }}
      >
        <Text className={cn('text-[20px]', lit ? 'text-foreground' : 'text-muted-foreground')}>
          {star(lit)}
        </Text>
      </Animated.View>
    </Pressable>
  );
}
