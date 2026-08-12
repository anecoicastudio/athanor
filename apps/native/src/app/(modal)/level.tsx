import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { t, type MessageKey } from '@athanor/i18n';
import { Text, View } from '@/tw';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { Button } from '@/components/Button';
import { Mandorla } from '@/components/Mandorla';
import { SectionLabel } from '@/components/SectionLabel';
import { useAuth } from '@/lib/auth-context';
import { MODAL_A11Y, useAnnounceOnMount } from '@/lib/a11y';

/**
 * Level-up overlay — fired when the score-engine broadcasts a `tier_up` celebration.
 * Route param `tier` is a tier id (e.g. 'bagliore', 'luce', 'faro', 'costellazione').
 *
 * Mirrors the match.tsx overlay pattern exactly: centered Animated.View fade + scale
 * entrance, glowing <Mandorla> burst (rule #4 — a moment happened: tier crossed),
 * reduced-motion safe (opacity-in only, no transform, hold ~600ms entrance).
 *
 * Registered with `animation: 'fade'` (not presentation:'modal') like match.tsx.
 */
export default function LevelOverlay() {
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const router = useRouter();
  const { tier = '' } = useLocalSearchParams<{ tier: string }>();

  const reduceMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(0.9)).current;
  const opacity = useRef(new Animated.Value(0)).current;

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
      <View className="flex-1 items-center justify-center bg-background px-8">
        <Animated.View style={reduceMotion ? undefined : { transform: [{ scale }] }}>
          {/* glowing Mandorla burst — high glow (glowLevel 1), rule #4: a moment happened */}
          <Mandorla size={96} glowLevel={1}>
            <Text className="text-3xl text-aura">✦</Text>
          </Mandorla>
        </Animated.View>

        <SectionLabel tone="aura" className="mt-6">
          {t('tier.up.eyebrow', locale)}
        </SectionLabel>
        <Text
          accessibilityRole="header"
          className="mt-2 text-center text-[26px] font-bold text-foreground"
        >
          {headline}
        </Text>
        <Text className="mt-3 text-center text-[15px] leading-[22px] text-muted-foreground">
          {t('tier.up.sub', locale)}
        </Text>

        <View className="mt-8 w-full">
          <Button
            variant="light"
            label={t('common.continue', locale)}
            onPress={() => router.back()}
          />
        </View>
      </View>
    </Animated.View>
  );
}
