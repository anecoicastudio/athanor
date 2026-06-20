import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import { t } from '@athanor/i18n';
import { mandorla, semantic } from '@athanor/config';
import { Text } from '@/tw';
import { deviceLocale } from '@/lib/locale';
import { useReducedMotion } from '@/lib/useReducedMotion';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedG = Animated.createAnimatedComponent(G);

const DASH = 240;
const SIZE = 112;
const LENS = 'M50 24 A30 30 0 0 1 50 76 A30 30 0 0 1 50 24 Z';

/**
 * Branded JS splash (prototype §9 / athanor-prototype.html) shown after fonts
 * load, over the routed Stack. The two-circle vesica + lens **draw** via animated
 * strokeDashoffset (circles 0→1.6s, lens 0.5→2.1s), the spark pops (1.5s), and
 * the «A T H A N O R» wordmark + tagline fade up — ~2.7s, then an 0.8s fade-out →
 * onDone. Honors reduced motion (static finished mark, brief hold). The native
 * `expo-splash-screen` covers the pre-JS frame; this is the brand beat after it.
 */
export function BrandSplash({ onDone }: { onDone: () => void }) {
  const circles = useRef(new Animated.Value(DASH)).current;
  const lens = useRef(new Animated.Value(DASH)).current;
  const spark = useRef(new Animated.Value(0)).current;
  const wordmark = useRef(new Animated.Value(0)).current;
  const tagline = useRef(new Animated.Value(0)).current;
  const container = useRef(new Animated.Value(1)).current;
  const reduce = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    let done = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    // Idempotent exit — called by the fade-out animation AND a hard fallback
    // timer, so onDone fires even if the animation's `finished` callback is
    // dropped (interrupted frame, re-render). The splash can never trap the UI.
    const finish = () => {
      if (done || cancelled) return;
      done = true;
      onDone();
    };

    const fadeOut = () => {
      Animated.timing(container, {
        toValue: 0,
        duration: 800,
        easing: Easing.ease,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) finish();
      });
      timers.push(setTimeout(finish, 900)); // guaranteed exit ~100ms after the fade
    };

    if (reduce) {
      // Static finished mark, brief hold, then leave.
      circles.setValue(0);
      lens.setValue(0);
      spark.setValue(1);
      wordmark.setValue(1);
      tagline.setValue(1);
      timers.push(setTimeout(fadeOut, 700));
    } else {
      const draw = (v: Animated.Value, delay: number) =>
        Animated.timing(v, {
          toValue: 0,
          duration: 1600,
          delay,
          easing: Easing.ease,
          useNativeDriver: false,
        });
      const fade = (v: Animated.Value, delay: number) =>
        Animated.timing(v, {
          toValue: 1,
          duration: 1000,
          delay,
          easing: Easing.ease,
          useNativeDriver: false,
        });
      Animated.parallel([
        draw(circles, 0),
        draw(lens, 500),
        Animated.timing(spark, {
          toValue: 1,
          duration: 600,
          delay: 1500,
          easing: Easing.ease,
          useNativeDriver: false,
        }),
        fade(wordmark, 700),
        fade(tagline, 1100),
      ]).start();
      timers.push(setTimeout(fadeOut, 2700));
    }

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [circles, lens, spark, wordmark, tagline, container, onDone, reduce]);

  // pop curve: scale .2 → 1.25 → 1 (prototype @keyframes pop).
  const sparkScale = spark.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.2, 1.25, 1] });
  const riseY = (v: Animated.Value) =>
    reduce ? 0 : v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        styles.fill,
        { backgroundColor: semantic.background, opacity: container },
      ]}
    >
      <Svg width={SIZE} height={SIZE} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id="splashLens" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={mandorla.lensTop} />
            <Stop offset="1" stopColor={mandorla.lensBottom} />
          </LinearGradient>
          <RadialGradient id="splashGlow" cx="50%" cy="42%" r="60%">
            <Stop offset="0" stopColor={semantic.aura} stopOpacity={0.24} />
            <Stop offset="1" stopColor={semantic.aura} stopOpacity={0} />
          </RadialGradient>
        </Defs>

        {/* two overlapping circles — stroke-draw */}
        <AnimatedCircle
          cx={35}
          cy={50}
          r={30}
          fill="none"
          stroke={mandorla.circle}
          strokeOpacity={0.35}
          strokeWidth={1.1}
          strokeDasharray={DASH}
          strokeDashoffset={circles}
        />
        <AnimatedCircle
          cx={65}
          cy={50}
          r={30}
          fill="none"
          stroke={mandorla.circle}
          strokeOpacity={0.35}
          strokeWidth={1.1}
          strokeDasharray={DASH}
          strokeDashoffset={circles}
        />

        {/* lens: depth fill + cyan glow (static), then the stroke draws in (delayed) */}
        <Path d={LENS} fill="url(#splashLens)" />
        <Path d={LENS} fill="url(#splashGlow)" />
        <AnimatedPath
          d={LENS}
          fill="none"
          stroke={semantic.aura}
          strokeOpacity={0.6}
          strokeWidth={1.2}
          strokeDasharray={DASH}
          strokeDashoffset={lens}
        />

        {/* three dots on the lens spine */}
        <Circle cx={50} cy={38} r={1.9} fill={semantic.aura} fillOpacity={0.75} />
        <Circle cx={50} cy={50} r={1.9} fill={semantic.aura} fillOpacity={0.75} />
        <Circle cx={50} cy={62} r={1.9} fill={semantic.aura} fillOpacity={0.75} />

        {/* spark — pops at the top of the lens */}
        <AnimatedG x={50} y={24} scale={sparkScale} opacity={spark}>
          <Path
            d="M0 -9 L1.6 -1.6 L9 0 L1.6 1.6 L0 9 L-1.6 1.6 L-9 0 L-1.6 -1.6 Z"
            fill={semantic.aura}
            fillOpacity={0.775}
          />
        </AnimatedG>
      </Svg>

      <Animated.View style={{ opacity: wordmark, transform: [{ translateY: riseY(wordmark) }] }}>
        <Text className="text-[22px] font-light text-foreground" style={styles.wordmark}>
          {t('app.name', deviceLocale).toUpperCase()}
        </Text>
      </Animated.View>

      <Animated.View style={{ opacity: tagline, transform: [{ translateY: riseY(tagline) }] }}>
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
