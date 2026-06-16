import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, PanResponder } from 'react-native';
import type { Locale, MomentoDeckCard } from '@athanor/schemas';
import { View } from '@/tw';
import { MomentoCard } from './MomentoCard';
import { SwipeStamp } from './SwipeStamp';

const THRESHOLD = 90;
const FLY_X = 520;

export type SwipeDeckHandle = { swipe: (dir: 'left' | 'right') => void };

/**
 * The load-bearing swipe gesture (frontend §9), built on RN-core `Animated` +
 * `PanResponder` — the established precedent (StoriesViewer). Deliberately NOT
 * reanimated / gesture-handler: those deps are unimported and have no babel plugin
 * wired, so importing them crashes the app.
 *
 * Drag → translate + tilt; the YES/NO stamps fade in past ±THRESHOLD. On release a
 * past-threshold drag flies the card out (±520px, −40y, ~420ms) then advances; under
 * threshold it springs back. Reduce Motion drops the tilt + fling for a quick fade.
 * `deckRef.current.swipe('left'|'right')` triggers the same fly-out from the buttons
 * (button/a11y parity). The whole pan value stays on the JS driver (useNativeDriver:
 * false) so the rotate/stamp interpolations stay correct and no driver is mixed.
 */
export function SwipeDeck({
  cards,
  locale,
  onAccept,
  onPass,
  onEmpty,
  deckRef,
}: {
  cards: MomentoDeckCard[];
  locale: Locale;
  onAccept: (card: MomentoDeckCard) => void;
  onPass: (card: MomentoDeckCard) => void;
  onEmpty: () => void;
  deckRef?: React.MutableRefObject<SwipeDeckHandle | null>;
}) {
  const [index, setIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const pan = useRef(new Animated.ValueXY()).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => setReduceMotion(false));
  }, []);

  useEffect(() => {
    pan.setValue({ x: 0, y: 0 });
  }, [index, pan]);

  // The parent refetches the deck after every accept/pass (invalidateQueries), handing us a
  // fresh, shorter `cards` array. Reset the cursor to the new top whenever the deck identity
  // changes — otherwise a stale `index` renders + acts on the WRONG card: the deck acts on
  // cards[index] while the parent's a11y labels + toast read cards[0], so a desynced index
  // accepts/passes (and labels) someone other than the visible person. (accept/pass always
  // removes the row server-side, so the id list — and this key — changes after each action.)
  const deckKey = cards.map((c) => c.id).join('|');
  useEffect(() => {
    setIndex(0);
  }, [deckKey]);

  const advance = (dir: 'left' | 'right', card: MomentoDeckCard) => {
    if (dir === 'right') onAccept(card);
    else onPass(card);
    const ni = index + 1;
    setIndex(ni);
    if (ni >= cards.length) onEmpty();
  };

  const flyOut = (dir: 'left' | 'right') => {
    const card = cards[index];
    if (!card) return;
    const toX = dir === 'right' ? FLY_X : -FLY_X;
    Animated.timing(pan, {
      toValue: reduceMotion ? { x: 0, y: 0 } : { x: toX, y: -40 },
      duration: reduceMotion ? 160 : 420,
      useNativeDriver: false,
    }).start(() => advance(dir, card));
  };

  // Intentionally runs every render (no deps): re-binds the handle to the latest flyOut closure
  // so a button-triggered swipe() always uses the current `index`/`reduceMotion`. Do NOT add a dep array.
  useEffect(() => {
    if (deckRef) deckRef.current = { swipe: flyOut };
  });

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
        onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: (_e, g) => {
          if (g.dx > THRESHOLD) flyOut('right');
          else if (g.dx < -THRESHOLD) flyOut('left');
          else
            Animated.spring(pan, {
              toValue: { x: 0, y: 0 },
              useNativeDriver: false,
            }).start();
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, cards, reduceMotion],
  );

  if (!cards[index]) return null;
  const top = cards[index];
  const next = cards[index + 1];

  const rotate = reduceMotion
    ? '0deg'
    : pan.x.interpolate({
        inputRange: [-260, 0, 260],
        outputRange: ['-18deg', '0deg', '18deg'],
      });
  const yesOpacity = pan.x.interpolate({
    inputRange: [0, THRESHOLD],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const noOpacity = pan.x.interpolate({
    inputRange: [-THRESHOLD, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <View className="flex-1">
      {next ? (
        <View className="absolute inset-0 scale-95 opacity-70" pointerEvents="none">
          <MomentoCard card={next} locale={locale} />
        </View>
      ) : null}
      <Animated.View
        {...responder.panHandlers}
        style={{
          flex: 1,
          transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }],
        }}
      >
        <MomentoCard card={top} locale={locale} />
        <SwipeStamp kind="yes" opacity={yesOpacity} locale={locale} />
        <SwipeStamp kind="no" opacity={noOpacity} locale={locale} />
      </Animated.View>
    </View>
  );
}
