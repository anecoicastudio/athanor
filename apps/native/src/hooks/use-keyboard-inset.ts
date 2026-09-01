import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Keyboard, Platform, type KeyboardEvent } from 'react-native';

/**
 * How far the soft keyboard covers the bottom of the window, in points (#616).
 *
 * This is the whole keyboard-avoidance mechanism for the app: `KeyboardAvoiding` pads by
 * it, and `StoriesViewer` pads its chrome by it. Nothing else subscribes to keyboard
 * events — `lib/source-audit.test.ts` §8 pins that.
 *
 * ── WHY THIS IS THE KEYBOARD'S HEIGHT AND NOTHING ELSE ────────────────────────────
 * It reads `endCoordinates.height` and stops. Every consumer's wrapper reaches the
 * window bottom, so that IS the covered height, and on Android it is already net of the
 * system bars, which `Screen`'s own bottom inset carries.
 *
 * Three earlier designs measured the view instead, and all three failed on device:
 *
 * 1. `KeyboardAvoidingView` fed a `keyboardVerticalOffset` read once at mount from
 *    `onLayout` + `measureInWindow`. `onLayout` reports PARENT-RELATIVE layout, so a
 *    modal sheet sliding into place moves the view through the window without ever
 *    firing it again, and the mid-presentation `y` was never corrected.
 * 2. Measuring inside the keyboard event instead. The composer stayed under the keyboard
 *    with an inset of 0 — and no correct measurement can return 0 there, so the value was
 *    never arriving: `measureInWindow` is a round trip the UI thread may decline.
 * 3. Committing the keyboard height synchronously and letting the measurement NARROW it
 *    for the three consumers that stop short of the window bottom. Still 0 on device. A
 *    narrowing is the only thing in that design that can undo a correct baseline, and it
 *    does so silently: `covered` clamps at 0, so one bad frame commits 0 and the lift
 *    disappears.
 *
 * The measurement is therefore gone rather than guarded again. What it bought was a
 * trimmed lift on `(modal)/plan`, `(modal)/progress` (content above a pinned
 * `Screen footer`) and `(tabs)/profile` (above the tab bar); those three now over-lift by
 * their bottom chrome, leaving a band of empty space above the keyboard. That is the
 * deliberate trade, and the direction matters: over-lifting wastes space, under-lifting
 * hides the control the member is typing into. Two device reds bought that lesson.
 *
 * Two behaviours are ported from `KeyboardAvoidingView`: `scheduleLayoutAnimation` (its
 * LayoutAnimation config, taken from the event, so the padding rides the keyboard's own
 * curve and is a no-op on Android where duration is 0), and the
 * `prefersCrossFadeTransitions` guard — with that iOS setting on, the keyboard frame
 * reports `screenY: 0` and a naive read would lift by a whole screen. `willShow`/
 * `willHide` over `willChangeFrame` is theirs too: undocked, split and floating keyboards
 * emit a change-frame before the hide, so the pair is what reads them correctly.
 *
 * The `__DEV__` lines are unconditional on purpose. The previous design only logged
 * anomalies, so a run where nothing arrived printed nothing and a second device round was
 * spent not knowing whether the listener had even fired.
 */
export function useKeyboardInset(): number {
  const alive = useRef(true);
  const applied = useRef(0);
  const [inset, setInset] = useState(0);

  const commit = useCallback((next: number, event?: KeyboardEvent) => {
    if (!alive.current || applied.current === next) return;
    applied.current = next;
    if (event) Keyboard.scheduleLayoutAnimation(event);
    setInset(next);
  }, []);

  const show = useCallback(
    async (event: KeyboardEvent) => {
      const frame = event.endCoordinates;
      // iOS "Prefer Cross-Fade Transitions": the frame comes back with screenY 0 instead
      // of its real top, and every view would look fully covered.
      if (
        Platform.OS === 'ios' &&
        frame.screenY === 0 &&
        (await AccessibilityInfo.prefersCrossFadeTransitions())
      ) {
        if (__DEV__) console.warn('[keyboard] cross-fade transitions on, not lifting');
        commit(0, event);
        return;
      }
      if (__DEV__) {
        console.warn(
          `[keyboard] show h=${frame.height} screenY=${frame.screenY} -> ${frame.height}`,
        );
      }
      commit(frame.height, event);
    },
    [commit],
  );

  useEffect(() => {
    alive.current = true;
    // iOS fires `will*` ahead of the animation; Android only has `did*`.
    const ios = Platform.OS === 'ios';
    if (__DEV__) console.warn(`[keyboard] listening (${ios ? 'will' : 'did'})`);
    const onShow = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      void show(e);
    });
    const onHide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', (e) => {
      if (__DEV__) console.warn('[keyboard] hide -> 0');
      commit(0, e);
    });
    // Mounted with the keyboard already up — a screen pushed from one that had it.
    if (Keyboard.isVisible()) {
      const metrics = Keyboard.metrics();
      if (__DEV__) console.warn(`[keyboard] already up h=${metrics?.height ?? 'none'}`);
      if (metrics) commit(metrics.height);
    }
    return () => {
      alive.current = false;
      onShow.remove();
      onHide.remove();
    };
  }, [show, commit]);

  return inset;
}
