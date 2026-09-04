import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, type PanResponderGestureState } from 'react-native';
import type { Locale, MomentoDeckCard } from '@athanor/schemas';
import { View } from '@/tw';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import {
  COMMIT_DISTANCE_PX,
  FLY_OUT_MS,
  FLY_OUT_REDUCED_MS,
  FLY_OUT_X_PX,
  FLY_OUT_Y_PX,
  shouldClaimSwipe,
  swipeCommitDirection,
} from '@/lib/swipe-gesture';
import { MomentoCard } from './MomentoCard';
import { SwipeStamp } from './SwipeStamp';

export type SwipeDeckHandle = { swipe: (dir: 'left' | 'right') => void };

/**
 * The load-bearing swipe gesture (frontend §9), built on RN-core `Animated` +
 * `PanResponder` — the established precedent (StoriesViewer). Deliberately NOT
 * reanimated / gesture-handler: both sit in package.json but are unimported app-wide,
 * and this gesture needs nothing PanResponder lacks. A rewrite on top of them is an
 * option for a future issue, not a change to smuggle into this component (#357).
 *
 * The deck renders inside the tab's vertical ScrollView, so the gesture claims only
 * horizontal intent (`shouldClaimSwipe`) and, once claimed, refuses termination
 * requests; if the platform tears the responder away regardless, `Terminate` springs
 * the card back instead of leaving it parked mid-air (#357).
 *
 * Drag → translate + tilt; the YES/NO stamps fade in past ±COMMIT_DISTANCE_PX. On
 * release, `swipeCommitDirection` (threshold drag OR fast flick) flies the card out
 * (constants in `@/lib/swipe-gesture`) then advances — only when the fly-out actually
 * `finished`, so a refetch-driven reset mid-flight no longer advances a half-moved
 * card; anything else springs back. Reduce Motion drops the tilt + fling for a quick
 * fade. `deckRef.current.swipe('left'|'right')` triggers the same fly-out from the
 * buttons (button/a11y parity). The whole pan value stays on the JS driver
 * (useNativeDriver: false) so the rotate/stamp interpolations stay correct and no
 * driver is mixed.
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
  const reduceMotion = useReducedMotion();
  const pan = useRef(new Animated.ValueXY()).current;

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
    const toX = dir === 'right' ? FLY_OUT_X_PX : -FLY_OUT_X_PX;
    Animated.timing(pan, {
      toValue: reduceMotion ? { x: 0, y: 0 } : { x: toX, y: FLY_OUT_Y_PX },
      duration: reduceMotion ? FLY_OUT_REDUCED_MS : FLY_OUT_MS,
      useNativeDriver: false,
    }).start(({ finished }) => {
      // A refetch landing mid-flight resets pan/index (the effects above), which kills
      // this animation with finished: false — the deck already moved on, so advancing
      // anyway acted on the old card against the new deck: half-moved card, desynced
      // index (#357). StoriesViewer's progress timer guards the same way.
      if (finished) advance(dir, card);
    });
  };

  const springBack = () => {
    Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
  };

  // The card under the finger when the gesture was claimed. If a post-accept refetch
  // swaps the deck mid-drag, the release must NOT commit against whoever slid into
  // cards[index] — that would accept/pass a person the user never saw move (#357).
  const grantedCardIdRef = useRef<string | null>(null);

  const onGrant = () => {
    grantedCardIdRef.current = cards[index]?.id ?? null;
  };
  const onRelease = (g: PanResponderGestureState) => {
    const dir = swipeCommitDirection(g.dx, g.vx);
    if (dir && cards[index]?.id === grantedCardIdRef.current) flyOut(dir);
    else springBack();
  };

  // Intentionally runs every render (no deps): re-binds the latest closures so the
  // once-created responder below and a button-triggered swipe() always read the current
  // `index`/`cards`/`reduceMotion`. Do NOT add a dep array.
  const gestureRef = useRef({ onGrant, onRelease, onTerminate: springBack });
  useEffect(() => {
    gestureRef.current = { onGrant, onRelease, onTerminate: springBack };
    if (deckRef) deckRef.current = { swipe: flyOut };
  });

  // Created ONCE (`pan` is a stable ref): the old deps [index, cards, reduceMotion]
  // rebuilt the responder whenever a refetch changed `cards` identity, so a gesture in
  // flight kept firing into the previous responder's stale closures (#357). Callbacks
  // that need current state go through `gestureRef` instead.
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => shouldClaimSwipe(g.dx, g.dy),
        // Once claimed, never hand the gesture to the enclosing ScrollView mid-drag —
        // the default (allow) is how cards froze mid-air: Release never fired and
        // nothing reset `pan` (#357).
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => gestureRef.current.onGrant(),
        onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: (_e, g) => gestureRef.current.onRelease(g),
        onPanResponderTerminate: () => gestureRef.current.onTerminate(),
      }),
    [pan],
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
    inputRange: [0, COMMIT_DISTANCE_PX],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const noOpacity = pan.x.interpolate({
    inputRange: [-COMMIT_DISTANCE_PX, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <View className="flex-1">
      {/*
        The peek card is HIDDEN from the accessibility tree, not merely untouchable (#635).
        `pointerEvents="none"` settles touch and says nothing about VoiceOver, so this fully
        occluded card was still an element — and it is rendered FIRST, so the a11y tree listed
        the next person's whole card ahead of the top one while «Connetti» and «Passa» below
        still act on the current one. Read one person, act on another, on a control that cannot
        be undone.

        Both flags because they are different platforms' spelling of the same thing:
        `accessibilityElementsHidden` is iOS, `importantForAccessibility` is Android.
      */}
      {next ? (
        <View
          className="absolute inset-0 opacity-70"
          style={{ transform: [{ scale: 0.95 }] }}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
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
