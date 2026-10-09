import { useEffect, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { FONT_SCALE_CAP } from '@/lib/type-scale';
import { useAnimatedValue } from '@/hooks/use-animated-value';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

/**
 * Moment flash (frontend `02` §9): a help became real, or a star was lit.
 * A centred foreground ✦ on a charcoal disc + the «Hai avvicinato un sogno ✦» pill for ~700ms.
 * No light around it and no cyan since 2026-10-05: nothing on mobile glows, and this is not
 * one of the five celebration screens (DESIGN §2.3).
 *
 * `flash` is the episode's id — a milestone id, a star id — and `null` for nothing to say. An
 * id rather than a boolean because the flash outlives nothing: it shows once per id and stops,
 * even while the caller's condition is still true.
 *
 * Reduced-motion safe: under Reduce Motion it fades opacity only (no scale/transform).
 * Uses the RN core `Animated` API + `AccessibilityInfo` (the codebase pattern, see
 * BrandSplash) rather than reanimated worklets — simpler and stable.
 *
 * The richer Foundation `burst` host M3 once planned was never built, and no open issue revives
 * it (as of 2026-09-26), so this inline flash is the implementation, not a stand-in.
 * Never animates an Aura number — there is none in M2 (rule #1).
 */
export function MomentFlash({ flash, locale }: { flash: string | null; locale: Locale }) {
  // The EPISODE that has already played out, not a mounted flag. `flash` is a level — the
  // caller's condition outlives the ~700ms show (a star grant holds for 2800ms) — so the flash
  // has to take itself off screen. Holding that as `mounted` meant turning it ON from inside
  // the effect (#691); holding the finished episode instead makes «still showing» a comparison
  // during render, and the fade-out callback is the only writer.
  const [playedOut, setPlayedOut] = useState<string | null>(null);
  const showing = flash !== null && playedOut !== flash;
  const reduceMotion = useReducedMotion();
  const opacity = useAnimatedValue(0);
  const scale = useAnimatedValue(0.9);

  useEffect(() => {
    if (flash === null) return;
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
      }).start(() => setPlayedOut(flash));
    }, 520);
    return () => clearTimeout(out);
  }, [flash, reduceMotion, opacity, scale]);

  if (!showing) return null;

  return (
    <View
      pointerEvents="none"
      className="absolute inset-x-0 top-1/3 items-center"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={t('help.toast.completed', locale)}
    >
      <Animated.View style={{ opacity, alignItems: 'center' }}>
        <Animated.View style={reduceMotion ? undefined : { transform: [{ scale }] }}>
          <View className="h-20 w-20 items-center justify-center rounded-full border border-hair bg-surface">
            {/* `ornament` (#639): the moment mark, hidden from assistive tech, inside a hard
                80pt disc that a scale animation drives. The cap is 1, so the 32pt mark is the
                same size at every text setting and cannot outgrow the disc (§10). */}
            <Text
              className="type-h1 text-foreground"
              maxFontSizeMultiplier={FONT_SCALE_CAP.ornament}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              ✦
            </Text>
          </View>
        </Animated.View>
        <View className="mt-4 rounded-full border border-hair bg-surface px-5 py-2">
          <Text className="text-[14px] font-semibold text-foreground">
            {t('help.toast.completed', locale)}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}
