import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Keyboard, Platform, type KeyboardEvent } from 'react-native';

/** Keyboard tracing, on while #616's mechanism is unproven on device. Delete with the doubt. */
const TRACE = __DEV__;

/**
 * How far the soft keyboard covers the bottom of the window, in points (#616).
 *
 * This is the whole keyboard-avoidance mechanism for the app: `KeyboardAvoiding` pads by
 * it, and `StoriesViewer` pads its chrome by it. Nothing else subscribes to keyboard
 * events — `lib/source-audit.test.ts` §8 pins that.
 *
 * ── WHY THIS IS THE KEYBOARD'S HEIGHT AND NOTHING ELSE ────────────────────────────
 * It reads `endCoordinates.height` and stops. Every consumer's wrapper reaches the window
 * bottom except the three named below, so that IS the covered height, and on Android it is
 * already net of the system bars, which `Screen`'s own bottom inset carries.
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
 *    for the three consumers that stop short of the window bottom. Still 0 on device.
 *
 * ── WHAT IS AND IS NOT ESTABLISHED ────────────────────────────────────────────────
 * The narrowing is the only thing in design 3 that can undo a correct baseline — `covered`
 * clamps at 0, so one bad frame commits 0 and the lift disappears a frame after being set
 * right. That is why it is gone rather than guarded a third time.
 *
 * It is NOT established that this is what happened, and the instrumentation argues against
 * it: on the bundle that was tested, a `covered` of 0 would have printed
 * `[keyboard] measured 0: …` exactly once, because it is below the keyboard height and the
 * once-per-mount flag was still unset. So if that build's logs were captured and silent,
 * the narrowing is exonerated and the cause is elsewhere. No logs have been read yet, so
 * even the silence is unconfirmed.
 *
 * One half IS established, and it removes a whole branch of the search: **the layout works.**
 * Forcing a fixed inset through this hook's consumer in the web build moved chat's composer
 * bottom from 731 to 431 — exactly the 300 injected. `paddingBottom` on the wrapper shrinks
 * `Screen` and lifts the composer as designed, on a real render of the real screen. So the
 * failure is entirely in getting a non-zero number OUT of this hook, never in what the
 * consumers do with it. What remains is whether the listener fires at all and whether
 * `__DEV__` was even true in the build under test — which is what the registration trace
 * below exists to settle. The experiment is re-runnable: PR #620's body carries the recipe
 * (web build, force a fixed inset through `KeyboardAvoiding`, read the composer's
 * `getBoundingClientRect().bottom` before and after), so this account and that one can be
 * checked against each other rather than drifting apart.
 *
 * What the MEASUREMENT bought, and what deleting it costs: a trimmed lift on
 * `(modal)/plan`, `(modal)/progress` (content above a pinned `Screen footer`) and
 * `(tabs)/profile` (above the tab bar). Those three now over-lift by their bottom chrome,
 * leaving a band of empty space above the keyboard. That is the deliberate trade, and the
 * direction matters: over-lifting wastes space, under-lifting hides the control the member
 * is typing into. Two device reds bought that lesson.
 *
 * Two behaviours are ported from `KeyboardAvoidingView`: `scheduleLayoutAnimation` (its
 * LayoutAnimation config, taken from the event, so the padding rides the keyboard's own
 * curve and is a no-op on Android where duration is 0), and the
 * `prefersCrossFadeTransitions` guard — with that iOS setting on, the keyboard frame
 * reports `screenY: 0` and a naive read would lift by a whole screen. `willShow`/
 * `willHide` over `willChangeFrame` is theirs too: undocked, split and floating keyboards
 * emit a change-frame before the hide, so the pair is what reads them correctly.
 *
 * `TRACE` is unconditional on purpose, and is a named constant so that turning it off is a
 * one-line revert rather than an archaeology exercise. The previous design logged only
 * anomalies, so a run where nothing arrived printed nothing, and a device round was spent
 * unable to tell "never fired" from "fired and was overwritten". The traces are
 * `console.log`; the two surprises — cross-fade transitions on, and a throw out of the
 * show handler — warn. Note this hook runs per mounted consumer, so a sheet over a tab
 * screen prints two of every line.
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
        if (TRACE) console.warn('[keyboard] cross-fade transitions on, not lifting');
        commit(0, event);
        return;
      }
      if (TRACE) {
        console.log(
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
    if (TRACE) console.log(`[keyboard] listening (${ios ? 'will' : 'did'})`);
    const onShow = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      // `show` is async, so a throw would otherwise become a voided rejection and the
      // handler would die leaving no trace — the exact shape of failure this whole
      // investigation has been chasing.
      show(e).catch((err: unknown) => {
        if (TRACE) console.warn(`[keyboard] show threw: ${String(err)}`);
      });
    });
    const onHide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', (e) => {
      if (TRACE) console.log('[keyboard] hide -> 0');
      commit(0, e);
    });
    // Mounted with the keyboard already up — a screen pushed from one that had it.
    if (Keyboard.isVisible()) {
      const metrics = Keyboard.metrics();
      if (TRACE) console.log(`[keyboard] already up h=${metrics?.height ?? 'none'}`);
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
