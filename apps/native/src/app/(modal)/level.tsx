import { useEffect } from 'react';
import { Animated, Easing } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { t, type MessageKey } from '@athanor/i18n';
import { ScrollView, Text, View } from '@/tw';
import { useLocale } from '@/hooks/use-locale';
import { useAnimatedValue } from '@/hooks/use-animated-value';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { Button } from '@/components/Button';
import { CelebrationMark } from '@/components/CelebrationMark';
import { SectionLabel } from '@/components/SectionLabel';
import { MODAL_A11Y, useAnnounceOnMount } from '@/lib/a11y';
import { useGuardedBack } from '@/lib/modal-exit';
import { Screen } from '@/components/Screen';

/**
 * Level-up overlay — fired when the score-engine broadcasts a `tier_up` celebration.
 * Route param `tier` is a tier id (e.g. 'bagliore', 'luce', 'faro', 'costellazione').
 *
 * One of the five celebration screens, in the composition they share (DESIGN §2.3, §8.12;
 * Galleria, 2026-10-09, #921): `CelebrationMark`, one cyan label, the h1, one grey line, the
 * cyan pill. No card, no glow, and no Aura number. It scrolls because nothing here is capped.
 *
 * The screen fades in and the mark flashes once (DESIGN §10's one effect), as on match:
 * the scale stands around the mark only. Reduced-motion safe: under Reduce Motion the screen
 * fades and nothing moves.
 *
 * Registered with `animation: 'fade'` (not presentation:'modal') like match.tsx.
 */
export default function LevelOverlay() {
  const locale = useLocale();
  const leave = useGuardedBack();
  const { tier = '' } = useLocalSearchParams<{ tier: string }>();

  const reduceMotion = useReducedMotion();
  const scale = useAnimatedValue(0.9);
  const opacity = useAnimatedValue(0);

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    if (!reduceMotion) {
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.15,
          duration: 320,
          easing: Easing.out(Easing.back(1.6)),
          useNativeDriver: true,
        }),
        Animated.timing(scale, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      scale.setValue(1);
    }
  }, [reduceMotion, opacity, scale]);

  // Localize the tier id → display name (e.g. 'bagliore' → 'Bagliore' / 'Glow').
  const tierName = tier ? t(`tier.${tier}` as MessageKey, locale) : tier;
  const headline = t('tier.up.title', locale, { tier: tierName });
  useAnnounceOnMount(headline);

  return (
    <Animated.View {...MODAL_A11Y} style={{ opacity, flex: 1 }}>
      <Screen>
        <ScrollView contentContainerClassName="grow items-center justify-center gap-[26px] px-5 py-12">
          <Animated.View style={reduceMotion ? undefined : { transform: [{ scale }] }}>
            <CelebrationMark />
          </Animated.View>

          <View className="items-center gap-2">
            <SectionLabel tone="celebration">{t('tier.up.eyebrow', locale)}</SectionLabel>
            <Text accessibilityRole="header" className="text-center type-h1 text-foreground">
              {headline}
            </Text>
            <Text className="text-center type-small text-muted-foreground">
              {t('tier.up.sub', locale)}
            </Text>
          </View>

          <View className="self-stretch">
            <Button variant="celebration" label={t('common.continue', locale)} onPress={leave} />
          </View>
        </ScrollView>
      </Screen>
    </Animated.View>
  );
}
