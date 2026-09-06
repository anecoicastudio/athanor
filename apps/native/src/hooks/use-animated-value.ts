import { useState } from 'react';
import { Animated } from 'react-native';

/**
 * A stable `Animated.Value` (or `ValueXY`) for the life of the component.
 *
 * This replaces `useRef(new Animated.Value(x)).current`, the shape the whole animation layer
 * used before #691. That shape READS a ref during render, which `react-hooks/refs` rejects —
 * and the taint spreads: every `interpolate` off the value and every style that carries it is
 * flagged too, so the React Compiler skipped the entire component. Six values in BrandSplash
 * cost 22 diagnostics between them.
 *
 * A lazy `useState` initialiser is the same guarantee — one instance per mount, stable identity
 * for `useMemo` deps — without the ref read. It is also strictly less work: `useRef(new
 * Animated.Value(0))` constructs a fresh value on EVERY render and throws all but the first away.
 *
 * Deliberately NOT `useAnimatedValue` from `react-native`: RN 0.86 exports it, but
 * react-native-web 0.21 does not, and expo-web is the QA surface on this machine — the import
 * would be `undefined` there and take the web build down.
 */
export function useAnimatedValue(initial: number): Animated.Value {
  const [value] = useState(() => new Animated.Value(initial));
  return value;
}

/** `useAnimatedValue` for a 2-axis value — the swipe deck's pan. */
export function useAnimatedValueXY(initial?: { x: number; y: number }): Animated.ValueXY {
  const [value] = useState(() => new Animated.ValueXY(initial));
  return value;
}
