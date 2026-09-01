import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Keyboard, Platform, type KeyboardEvent, type View } from 'react-native';

/**
 * How far a view's bottom edge is covered by the soft keyboard, in points (#616).
 *
 * This is the whole keyboard-avoidance mechanism for the app: `KeyboardAvoiding`
 * pads by it, and `StoriesViewer` pads its chrome by it. Nothing else subscribes
 * to keyboard events — `lib/source-audit.test.ts` §8 pins that.
 *
 * ── WHY NOT `KeyboardAvoidingView` ANY MORE ───────────────────────────────────
 * The arithmetic here is RN's own `padding` formula, unchanged: the covered
 * height is `viewBottomInWindow - keyboardTopInScreen`, and #163's clamp of a
 * negative window `y` to 0 is preserved (on Android `measureInWindow` subtracts
 * `getWindowVisibleDisplayFrame().top`, so a full-bleed root reports a negative
 * `y`; clamping is what made the old `keyboardVerticalOffset` come out right
 * there, and dropping it would silently under-lift by the status-bar height).
 *
 * What changes is WHEN the view is measured. `KeyboardAvoidingView` reads its
 * offset from a prop, and that prop was fed by a one-shot `onLayout` +
 * `measureInWindow` at mount. `onLayout` reports PARENT-RELATIVE layout, so a
 * modal sheet sliding up moves the view through the window without ever firing
 * it again: the mount-time `y` — read mid-presentation — was never corrected,
 * and `chat` (a sheet pushed from a sheet, the largest top gap in the app) ate
 * the whole error. The offset cannot be fixed from outside the component either:
 * `KeyboardAvoidingView` subscribes in `componentDidMount`, which always runs
 * BEFORE a parent effect, so its handler reads the stale prop and it never
 * recomputes for a prop change.
 *
 * So the measurement moves to the moment it is used — inside the keyboard event,
 * when every presentation animation has finished (the keyboard cannot appear
 * before a field is focused). No timing guess is left, and the iOS/Android
 * `behavior` split goes with it: padding shrinks the box on both platforms,
 * whether or not Android's window resized for the IME.
 *
 * Three behaviours are ported deliberately from `KeyboardAvoidingView`:
 * `Keyboard.scheduleLayoutAnimation` (its LayoutAnimation config, taken straight
 * from the event, so the padding rides the keyboard's own curve and is a no-op on
 * Android, where duration is 0); the `prefersCrossFadeTransitions` guard (with
 * that iOS setting on, the keyboard frame reports `screenY: 0` and the naive math
 * would lift by a whole screen); and the choice of `willShow`/`willHide` over
 * `willChangeFrame` — undocked, split and floating keyboards emit a change-frame
 * before the hide, so the pair is what reads them correctly.
 *
 * Measuring is asynchronous twice over (an `await` on iOS, then the
 * `measureInWindow` hop), so a result can land after the keyboard it describes is
 * gone, or after the screen is. `frame.current` holds the event's own
 * `endCoordinates` object — a new one per show, null on hide — so object identity
 * says whether a measurement still describes what is on screen, and `alive` says
 * whether anything is left to pad.
 *
 * ── WHY THE KEYBOARD'S OWN HEIGHT IS APPLIED FIRST ────────────────────────────
 * The first device run of the rewrite came back with the DM composer still fully
 * under the keyboard — inset 0, not a short lift. On that screenshot (375×812,
 * sheet top 47pt, keyboard top 463pt) the wrapper runs from 47 to the window
 * bottom, so the covered height is 349 and NO correct measurement can return 0.
 * The value was therefore never arriving: `measureInWindow` is a round trip to
 * the UI thread that can decline to call back, and a lift that exists only inside
 * that callback is a lift that can silently not happen.
 *
 * So the event's own `endCoordinates.height` is committed synchronously, before
 * any hop. It is the right answer for every view that reaches the window bottom,
 * and it is what the keyboard covers on both platforms (Android's is net of the
 * system bars, which `Screen`'s own bottom inset carries). Three consumers do not
 * reach it — `(modal)/plan` and `(modal)/progress` sit above a pinned
 * `Screen footer`, `(tabs)/profile` above the tab bar — and for those the
 * measurement NARROWS the baseline when it arrives. It is applied only on a
 * keyboard event, never on a re-layout, so a narrowed screen is not raised back
 * to the full height and then narrowed again on every relayout.
 *
 * A measurement is believed whenever it describes a real frame, including a
 * result of zero: a short keyboard — a hardware accessory bar — under a tall
 * footer genuinely covers none of the content region. What is NOT believed is a
 * zero-height frame, which is not a measurement of anything. That is the only
 * discard, and it is deliberately not a floor on the covered height: guarding
 * that instead would defend against a delivered-but-wrong value, which is a
 * hypothesis the diagnosis above rejected, and would make a legitimate zero
 * unfalsifiable.
 *
 * The `__DEV__` warnings are placed where the failure can actually be seen: on a
 * missing node, on a callback that never answers, on a degenerate frame, on a
 * covered height above the keyboard's own, and once per mount on a narrowing.
 * A silent early return inside the callback would have been blind to exactly the
 * case that motivated this.
 */
export function useKeyboardInset(): {
  ref: React.RefObject<View | null>;
  onLayout: () => void;
  inset: number;
} {
  const ref = useRef<View>(null);
  // The last keyboard frame, or null while the keyboard is down. Held in a ref so
  // `onLayout` can recompute against it without re-subscribing.
  const frame = useRef<KeyboardEvent['endCoordinates'] | null>(null);
  const applied = useRef(0);
  const alive = useRef(true);
  // Bounds the narrowing warning to one line per mount, so the three consumers that
  // narrow by design cannot bury a real one.
  const logged = useRef(false);
  const [inset, setInset] = useState(0);

  const commit = useCallback((next: number, event?: KeyboardEvent) => {
    if (!alive.current || applied.current === next) return;
    applied.current = next;
    if (event) Keyboard.scheduleLayoutAnimation(event);
    setInset(next);
  }, []);

  const measure = useCallback(
    async (event: KeyboardEvent | undefined, baseline: boolean) => {
      const current = frame.current;
      if (!current) {
        commit(0, event);
        return;
      }
      // iOS "Prefer Cross-Fade Transitions": the keyboard frame comes back with
      // screenY 0 instead of its real top, so every view would look fully covered.
      if (
        Platform.OS === 'ios' &&
        current.screenY === 0 &&
        (await AccessibilityInfo.prefersCrossFadeTransitions())
      ) {
        if (frame.current === current) commit(0, event);
        return;
      }
      // Synchronous, before any round trip: what the keyboard covers of the window.
      // Only on a keyboard event — a re-layout must not raise a narrowed screen back.
      if (baseline) commit(current.height, event);

      const node = ref.current;
      if (!node) {
        if (__DEV__) console.warn('[keyboard] nothing to measure; keeping the keyboard height');
        return;
      }
      let answered = false;
      node.measureInWindow((_x, y, _width, height) => {
        answered = true;
        // The keyboard may have hidden — the hide listener already committing 0 — or
        // changed frame while this hop was in flight. Either way this measurement is
        // about a keyboard that is no longer the one on screen, and committing it would
        // leave the view padded up with nothing under it.
        if (frame.current !== current) return;
        const numbers = `y=${y} h=${height} screenY=${current.screenY} kb=${current.height}`;
        if (height <= 0) {
          if (__DEV__) console.warn(`[keyboard] degenerate frame, keeping the height: ${numbers}`);
          return;
        }
        const covered = Math.max(0, Math.max(0, y) + height - current.screenY);
        if (
          __DEV__ &&
          (covered > current.height || (covered < current.height && !logged.current))
        ) {
          logged.current = true;
          console.warn(`[keyboard] measured ${covered}: ${numbers}`);
        }
        commit(Math.min(current.height, covered), event);
      });
      if (__DEV__) {
        // Dev-only, generously long: the point is to name a callback that never came,
        // not to time one that did.
        setTimeout(() => {
          // `alive` too: a screen dismissed within the window did not lose a callback, it
          // went away — and a false alarm here is an alarm on the exact bug this names.
          if (!answered && alive.current) console.warn('[keyboard] measureInWindow never answered');
        }, 500);
      }
    },
    [commit],
  );

  useEffect(() => {
    alive.current = true;
    // iOS fires `will*` ahead of the animation; Android only has `did*`.
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (event: KeyboardEvent) => {
        frame.current = event.endCoordinates;
        void measure(event, true);
      },
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      (event: KeyboardEvent) => {
        frame.current = null;
        commit(0, event);
      },
    );
    // Mounted with the keyboard already up — a screen pushed from one that had it.
    if (Keyboard.isVisible()) {
      frame.current = Keyboard.metrics() ?? null;
      void measure(undefined, true);
    }
    return () => {
      alive.current = false;
      show.remove();
      hide.remove();
    };
  }, [measure, commit]);

  // The view's own geometry can change under a raised keyboard (rotation, a tab
  // bar hiding, content growing). Padding does not move the view's frame, so this
  // cannot feed back on itself.
  const onLayout = useCallback(() => {
    if (frame.current) void measure(undefined, false);
  }, [measure]);

  return { ref, onLayout, inset };
}
