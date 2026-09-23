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
 * bottom except `(modal)/plan`, `(modal)/progress` and `(tabs)/profile`, so that IS the
 * covered height, and on Android it is already net of the system bars, which `Screen`'s own
 * bottom inset carries. (Named rather than counted: there is a SECOND trio further down —
 * the consumers that were never inside a sheet — and it overlaps this one by `profile`.)
 *
 * Three earlier designs measured the view instead, and all three failed on device:
 *
 * 1. `KeyboardAvoidingView` fed a `keyboardVerticalOffset` read once at mount from
 *    `onLayout` + `measureInWindow`. `onLayout` reports PARENT-RELATIVE layout, so a
 *    modal sheet sliding into place moves the view through the window without ever
 *    firing it again, and the mid-presentation `y` was never corrected.
 * 2. Measuring inside the keyboard event instead. The composer stayed under the keyboard
 *    with an inset of 0.
 * 3. Committing the keyboard height synchronously and letting the measurement NARROW it
 *    for the three consumers that stop short of the window bottom. Still 0 on device.
 *
 * ── WHY 2 AND 3 FAILED, AND THE RULE THAT FALLS OUT OF IT ─────────────────────────
 * Both of those reds were read at the time as "the measured value never arrived", which was
 * asserted without evidence. There is a structural reason it is probably the wrong reading:
 *
 * **`measureInWindow` inside a `presentation: 'modal'` screen is SHEET-RELATIVE, by
 * construction.** `RNSModalScreenShadowNode` sets the `RootNodeKind` trait, and RN's
 * `LayoutableShadowNode.cpp` (`getLayoutMetricsFromRoot`, the ancestor walk) stops at any
 * node carrying it — so the sheet's own window offset is never added. Designs 2 and 3 were
 * therefore fed a `y` measured from the sheet's top-left while the keyboard frame they were
 * subtracted from is in window space. Garbage, and garbage that clamps to 0 for a view near
 * the sheet's top. So the value was most likely arriving and wrong, not failing to arrive.
 *
 * "Most likely", because one step of that is inference rather than observation. What is
 * verified is that the call is sheet-relative by construction; that this is what produced
 * both reds was never watched happening, and it carries a loose end — design 3's narrowing
 * committing 0 would have printed `[keyboard] measured 0: …` exactly once, and that round
 * was reported as printing nothing. Those logs have still not been read. If any survive,
 * they settle it for free.
 *
 * What is not inference is the blast radius, and it is what turns deleting the measurement
 * from a judgement into a consequence: most `KeyboardAvoiding` consumers are `(modal)/*`, and
 * `StoriesViewer` renders on `(modal)/stories` too. Only the `(auth)` pair outside a sheet,
 * `(onboarding)` and `(tabs)/profile` are not — and `welcome` is exactly the screen that
 * lifted correctly on device while the measurement was still in. It was structurally wrong on
 * every sheet.
 *
 * So: **never reach for `measureInWindow` on a modal screen.** Every `(modal)/*` route is
 * inside a sheet — the group itself carries `presentation: 'modal'` (`app/_layout.tsx`) —
 * and that call has now cost this branch two device rounds. It will lie the same way a
 * third time.
 *
 * ── SETTLED ON DEVICE ──────────────────────────────────────────────────────────────
 * With nothing measuring, every composer lifts on device, `(modal)/chat` included (#658,
 * closed 2026-09-19). The layout half was never in doubt: forcing a fixed inset through
 * `KeyboardAvoiding` in the web build moves chat's composer by exactly the inset injected
 * (PR #620's body carries the recipe).
 *
 * ── THE BOTTOM SAFE-AREA INSET (#765) ───────────────────────────────────────────────
 * On iOS the keyboard rises from the window bottom, so its height already spans the home
 * indicator — and `Screen`'s native `SafeAreaView` pads its bottom by the provider's inset
 * whatever the view's position, so a lifted screen used to reserve those 34pt on top of the
 * keyboard. On Android `endCoordinates.height` is the IME inset MINUS the system bars
 * (`ReactRootView.checkForKeyboardEvents`), so there the bottom inset is exactly what closes
 * the gap and must stay. `keyboardCoversBottomInset` is that platform split, named once;
 * `KeyboardAvoiding` and `StoriesViewer` drop the bottom edge by it while the keyboard is up.
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
/**
 * Whether this hook's height already covers the bottom safe-area inset — iOS yes, Android no
 * (#765; the "BOTTOM SAFE-AREA INSET" section above). While the keyboard is up, a view lifted
 * by the height drops its bottom safe-area edge exactly when this is true.
 */
export const keyboardCoversBottomInset = Platform.OS === 'ios';

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
