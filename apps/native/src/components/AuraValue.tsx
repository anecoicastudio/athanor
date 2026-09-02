import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';
import { Text } from '@/tw';
import { t } from '@athanor/i18n';
import { useLocale } from '@/hooks/use-locale';
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
  /*
    What was last SAID, so a re-run of the effect cannot say it again. The effect announces on
    settle and depends on more than the number — `locale` since the sentence is keyed, and
    `reduce` already — so flipping the language from the settings modal re-ran the tween and
    re-announced «Aura 120» from the Home screen still mounted underneath. A screen reader
    repeating a number nothing changed is a claim that something happened (#635 review).
  */
  const announced = useRef<number | null>(null);
  // The announced sentence is user-facing copy, so it comes from the catalog like any other
  // (rule 5). It used to be a `Aura ${value}` template — invisible to `i18n:check`, which reads
  // rendered JSX, and to a reader, because nothing renders it (#635).
  const locale = useLocale();

  useEffect(() => {
    const id = anim.addListener(({ value: v }) => setDisplay(Math.round(v)));
    return () => anim.removeListener(id);
  }, [anim]);

  useEffect(() => {
    const announce = () => {
      if (announced.current === value) return;
      announced.current = value;
      AccessibilityInfo.announceForAccessibility(spoken(t('aura.a11y.value', locale, { value })));
    };
    if (reduce) {
      anim.setValue(value);
      setDisplay(value);
      announce();
    } else {
      Animated.timing(anim, {
        toValue: value,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) announce();
      });
    }
  }, [value, reduce, anim, locale]);

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
