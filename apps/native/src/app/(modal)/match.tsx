import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { t, type MessageKey } from '@athanor/i18n';
import { Pressable, Text, View } from '@/tw';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { Mandorla } from '@/components/Mandorla';
import { Button } from '@/components/Button';
import { useAuth } from '@/lib/auth-context';
import { MODAL_A11Y, useAnnounceOnMount } from '@/lib/a11y';

/**
 * Match overlay — fired on a MUTUAL Momento match (the deck navigates here on a
 * matched accept). This is the one glowing surface of the swipe-deck slice
 * (rule #4 — a moment happened): a glowing <Mandorla> burst with the ✦ mark.
 *
 * Reduced-motion safe: under Reduce Motion the burst fades opacity only (no
 * scale/transform), following the MomentFlash/AccessibilityInfo pattern.
 *
 * The «Apri il Momento» / «Scrivi a {name}» CTA opens the freshly created
 * conversation (the deck forwards `conversationId` on a mutual match); with no
 * id it just dismisses. «Più tardi» / «Continua a esplorare» dismisses.
 */
export default function MatchOverlay() {
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const router = useRouter();
  const {
    name = '',
    source = 'accepted',
    conversationId,
  } = useLocalSearchParams<{
    name: string;
    source: 'accepted' | 'incoming';
    conversationId?: string;
  }>();
  const accepted = source === 'accepted';
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

  const fill = (k: MessageKey) => t(k, locale, { name });

  const headline = accepted ? t('match.accepted.big', locale) : name;
  useAnnounceOnMount(headline);

  return (
    <Animated.View
      {...MODAL_A11Y}
      style={{ opacity }}
      className="flex-1 items-center justify-center bg-background px-8"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.close', locale)}
        onPress={() => router.back()}
        className="absolute right-5 top-12 h-11 w-11 items-center justify-center"
      >
        <Text className="text-2xl text-faint">×</Text>
      </Pressable>

      <Animated.View style={reduceMotion ? undefined : { transform: [{ scale }] }}>
        {/* glowing Mandorla burst — high glow (glowLevel 1), ✦ mark inside (rule #4) */}
        <Mandorla size={140} glowLevel={1}>
          <Text className="text-4xl text-aura">✦</Text>
        </Mandorla>
      </Animated.View>

      <Text className="mt-6 text-[12px] font-semibold uppercase tracking-wide text-aura">
        {accepted ? t('match.accepted.eyebrow', locale) : t('match.eyebrow', locale)}
      </Text>
      <Text
        accessibilityRole="header"
        className="mt-2 text-center text-[26px] font-bold text-foreground"
      >
        {headline}
      </Text>
      <Text className="mt-3 text-center text-[15px] leading-[22px] text-faint">
        {accepted ? fill('match.accepted.sub') : t('match.sub', locale)}
      </Text>
      <Text className="mt-3 text-[12px] text-faint">✦ Aura 0</Text>

      <View className="mt-8 w-full gap-3">
        <Button
          variant="light"
          glow
          label={accepted ? fill('match.accepted.writeCta') : t('match.openCta', locale)}
          onPress={() => {
            if (conversationId) router.replace(`/chat?conversationId=${conversationId}`);
            else router.back();
          }}
        />
        <Button
          variant="ghost"
          label={accepted ? t('match.accepted.keepCta', locale) : t('match.laterCta', locale)}
          onPress={() => router.back()}
        />
      </View>
    </Animated.View>
  );
}
