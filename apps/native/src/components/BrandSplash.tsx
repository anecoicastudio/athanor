import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';
import { t } from '@auria/i18n';
import type { Locale } from '@auria/schemas';
import { semantic } from '@auria/config';
import { Text } from '@/tw';
import { Mandorla } from '@/components/Mandorla';

const deviceLocale: Locale = (Intl.DateTimeFormat().resolvedOptions().locale ?? 'it').startsWith(
  'en',
)
  ? 'en'
  : 'it';

/**
 * Branded JS splash (prototype §9) shown after fonts load, over the routed Stack.
 * Animated mandorla + «A U R I A» wordmark + tagline, then fades out → onDone.
 * The native `expo-splash-screen` covers the pre-JS frame; this is the brand beat
 * after it. Honors reduced motion (static hold, no animation).
 */
export function BrandSplash({ onDone }: { onDone: () => void }) {
  const mark = useRef(new Animated.Value(0)).current;
  const wordmark = useRef(new Animated.Value(0)).current;
  const tagline = useRef(new Animated.Value(0)).current;
  const container = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let holdTimer: ReturnType<typeof setTimeout>;

    const fadeOut = () =>
      Animated.timing(container, { toValue: 0, duration: 500, useNativeDriver: true }).start(
        ({ finished }) => {
          if (finished && !cancelled) onDone();
        },
      );

    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return;
      if (reduced) {
        // Static: hold the final frame briefly, then leave.
        setReduceMotion(true);
        mark.setValue(1);
        wordmark.setValue(1);
        tagline.setValue(1);
        holdTimer = setTimeout(fadeOut, 700);
        return;
      }
      const fade = (v: Animated.Value, delay: number, duration = 600) =>
        Animated.timing(v, { toValue: 1, delay, duration, useNativeDriver: true });
      Animated.parallel([fade(mark, 0, 700), fade(wordmark, 700), fade(tagline, 1000)]).start();
      holdTimer = setTimeout(fadeOut, 2200);
    });

    return () => {
      cancelled = true;
      clearTimeout(holdTimer);
    };
  }, [container, mark, wordmark, tagline, onDone]);

  // translateY for the fade-up of wordmark + tagline (skipped under reduced motion).
  const rise = (v: Animated.Value) =>
    reduceMotion ? [] : [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }];

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        styles.fill,
        { backgroundColor: semantic.background, opacity: container },
      ]}
    >
      <Animated.View
        style={{
          opacity: mark,
          transform: reduceMotion
            ? []
            : [{ scale: mark.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
        }}
      >
        <Mandorla size={104} glowLevel={0.5}>
          <Text className="text-lg text-aura">✦</Text>
        </Mandorla>
      </Animated.View>

      <Animated.View style={{ opacity: wordmark, transform: rise(wordmark) }}>
        <Text className="text-[22px] font-light text-foreground" style={styles.wordmark}>
          {t('app.name', deviceLocale).toUpperCase()}
        </Text>
      </Animated.View>

      <Animated.View style={{ opacity: tagline, transform: rise(tagline) }}>
        <Text className="text-[11px] uppercase text-muted-foreground" style={styles.tagline}>
          {t('app.tagline', deviceLocale)}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { alignItems: 'center', justifyContent: 'center', gap: 26, zIndex: 60 },
  wordmark: { letterSpacing: 11, paddingLeft: 11 },
  tagline: { letterSpacing: 2.5 },
});
