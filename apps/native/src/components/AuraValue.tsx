import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';
import { cn, Text } from '@/tw';
import { t } from '@athanor/i18n';
import { useLocale } from '@/hooks/use-locale';
import { useAnimatedValue } from '@/hooks/use-animated-value';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { spoken } from '@/lib/star';

/**
 * The member's OWN Aura numeral, animated (spec §4 DRY) — one of the five cyan marks of the
 * mobile look (DESIGN §2.3), so it is mounted only where the number is the signed-in member's:
 * the Aura screen. Someone else's Aura is a plain `Text`. (Home's stars row mounted it until
 * 2026-10-05, at an inline size of its own; that row shows the lit stars only now, and the
 * prop for the size went on 2026-10-09.)
 * Tweens from previous to `value` over 700ms cubic ease.
 * Reduced-motion: snaps immediately.
 * Announces final value via AccessibilityInfo on settle.
 */
export function AuraValue({
  value,
  flashOnIncrease: _flashOnIncrease,
  className,
}: {
  value: number;
  flashOnIncrease?: boolean;
  className?: string;
}) {
  const anim = useAnimatedValue(value);
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
      // `type-num` (44/800, DESIGN §4) states the tabular figures itself.
      className={cn('type-num text-aura', className)}
      accessibilityRole="text"
    >
      {display}
    </Text>
  );
}
