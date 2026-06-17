import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';
import { Text } from '@/tw';

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
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduce)
      .catch(() => setReduce(false));
  }, []);

  useEffect(() => {
    const id = anim.addListener(({ value: v }) => setDisplay(Math.round(v)));
    return () => anim.removeListener(id);
  }, [anim]);

  useEffect(() => {
    if (reduce) {
      anim.setValue(value);
      setDisplay(value);
      AccessibilityInfo.announceForAccessibility(`Aura ${value}`);
    } else {
      Animated.timing(anim, {
        toValue: value,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) AccessibilityInfo.announceForAccessibility(`Aura ${value}`);
      });
    }
  }, [value, reduce, anim]);

  return (
    <Text
      className={`text-aura font-extrabold ${className ?? ''}`}
      style={{ fontSize: size, fontVariant: ['tabular-nums'] }}
      accessibilityRole="text"
    >
      {display}
    </Text>
  );
}
