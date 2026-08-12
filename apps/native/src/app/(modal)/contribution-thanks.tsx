import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { useRouter } from 'expo-router';
import { t } from '@athanor/i18n';
import { Text, View } from '@/tw';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { Button } from '@/components/Button';
import { Mandorla } from '@/components/Mandorla';
import { SectionLabel } from '@/components/SectionLabel';
import { useAuth } from '@/lib/auth-context';
import { MODAL_A11Y, useAnnounceOnMount } from '@/lib/a11y';

/**
 * Contribution thank-you overlay (M7 §3.6). A moment happened — your contribution
 * entered the fund. Carries NO Aura number (contributions are not scored, rule #1).
 * Mirrors candidacy-success.tsx (fade+scale burst, reduced-motion safe).
 * Registered with `animation: 'fade'` like level.tsx, match.tsx, candidacy-success.tsx.
 */
export default function ContributionThanksOverlay() {
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const router = useRouter();

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

  const headline = t('fund.thanks.title', locale);
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
          {t('fund.thanks.eyebrow', locale)}
        </SectionLabel>
        <Text
          accessibilityRole="header"
          className="mt-2 text-center text-[26px] font-bold text-foreground"
        >
          {headline}
        </Text>
        <Text className="mt-3 text-center text-[15px] leading-[22px] text-muted-foreground">
          {t('fund.thanks.sub', locale)}
        </Text>

        <View className="mt-8 w-full gap-3">
          <Button
            variant="light"
            label={t('fund.thanks.cta', locale)}
            onPress={() => router.back()}
          />
        </View>
      </View>
    </Animated.View>
  );
}
