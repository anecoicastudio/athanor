import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';
import { Text } from '@/tw';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { spoken } from '@/lib/star';

/**
 * Single animated tabular-nums Aura number (spec §4 DRY).
 * Tweens from previous to `value` over 700ms cubic ease.
 * Reduced-motion: snaps immediately.
 * Announces final value via AccessibilityInfo on settle.
 */
export function AuraValue({
  value,
  size = 44,
  flashOnIncrease: _flashOnIncrease,
  className,
}: {
  value: number;
  size?: number;
  flashOnIncrease?: boolean;
  className?: string;
}) {
  const anim = useRef(new Animated.Value(value)).current;
  const [display, setDisplay] = useState(value);
  const reduce = useReducedMotion();

  useEffect(() => {
    const id = anim.addListener(({ value: v }) => setDisplay(Math.round(v)));
    return () => anim.removeListener(id);
  }, [anim]);

  useEffect(() => {
    if (reduce) {
      anim.setValue(value);
      setDisplay(value);
      AccessibilityInfo.announceForAccessibility(spoken(`Aura ${value}`));
    } else {
      Animated.timing(anim, {
        toValue: value,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) AccessibilityInfo.announceForAccessibility(spoken(`Aura ${value}`));
      });
    }
  }, [value, reduce, anim]);

  return (
    <Text
      // DESIGN §8.5/§11: Aura is status, not a moment — foreground, never aura cyan.
      className={`text-foreground font-extrabold ${className ?? ''}`}
      style={{ fontSize: size, fontVariant: ['tabular-nums'] }}
      accessibilityRole="text"
    >
      {display}
    </Text>
  );
}
