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
  const [inset, setInset] = useState(0);

  const commit = useCallback((next: number, event?: KeyboardEvent) => {
    if (!alive.current || applied.current === next) return;
    applied.current = next;
    if (event) Keyboard.scheduleLayoutAnimation(event);
    setInset(next);
  }, []);

  const measure = useCallback(
    async (event?: KeyboardEvent) => {
      const current = frame.current;
      const node = ref.current;
      if (!current || !node) {
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
        commit(0, event);
        return;
      }
      node.measureInWindow((_x, y, _width, height) => {
        // The keyboard may have hidden — the hide listener already committing 0 — or
        // changed frame while this hop was in flight. Either way this measurement is
        // about a keyboard that is no longer the one on screen, and committing it would
        // leave the view padded up with nothing under it.
        if (frame.current !== current) return;
        commit(Math.max(0, Math.max(0, y) + height - current.screenY), event);
      });
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
        void measure(event);
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
      void measure();
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
    if (frame.current) void measure();
  }, [measure]);

  return { ref, onLayout, inset };
}
