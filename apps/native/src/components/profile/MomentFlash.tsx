import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { auraGlow } from '@/lib/glow';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

/**
 * Moment flash (frontend `02` §9): the one glow moment (rule #4) — a help became real.
 * A centered cyan ✦ pulse + the «Hai avvicinato un sogno ✦» toast for ~700ms.
 *
 * Reduced-motion safe: under Reduce Motion it fades opacity only (no scale/transform).
 * Uses the RN core `Animated` API + `AccessibilityInfo` (the codebase pattern, see
 * BrandSplash) rather than reanimated worklets — simpler and stable.
 *
 * TODO(M3): the richer Foundation `burst` host (Sheet/burst) replaces this inline flash.
 * Never animates an Aura number — there is none in M2 (rule #1).
 */
export function MomentFlash({ visible, locale }: { visible: boolean; locale: Locale }) {
  const [mounted, setMounted] = useState(false);
  const reduceMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (!visible) return;
    setMounted(true);
    opacity.setValue(0);
    scale.setValue(reduceMotion ? 1 : 0.9);
    const anims = [
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.ease,
        useNativeDriver: true,
      }),
    ];
    if (!reduceMotion) {
      anims.push(
        Animated.timing(scale, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.back(1.4)),
          useNativeDriver: true,
        }),
      );
    }
    Animated.parallel(anims).start();
    // Fade out and unmount after the ~700ms moment.
    const out = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        easing: Easing.ease,
        useNativeDriver: true,
      }).start(() => setMounted(false));
    }, 520);
    return () => clearTimeout(out);
  }, [visible, reduceMotion, opacity, scale]);

  if (!mounted) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{ opacity }}
      className="absolute inset-x-0 top-1/3 items-center"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={t('help.toast.completed', locale)}
    >
      <Animated.View
        style={[reduceMotion ? undefined : { transform: [{ scale }] }, auraGlow(1)]}
        className="h-20 w-20 items-center justify-center rounded-full border border-aura-line bg-raise"
      >
        <Text
          className="text-3xl text-aura"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          ✦
        </Text>
      </Animated.View>
      <View className="mt-4 rounded-full border border-hair bg-raise-2 px-5 py-2">
        <Text className="text-[14px] font-semibold text-foreground">
          {t('help.toast.completed', locale)}
        </Text>
      </View>
    </Animated.View>
  );
}
