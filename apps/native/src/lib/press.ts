/**
 * What a press looks like (DESIGN §10): a pill dims to 0.6 and scales to 0.98; a chip, a row,
 * an icon or a text link only dims. Neither is animated — the state is a cut, in and out.
 *
 * Under Reduce Motion the scale goes and the dim stays: §10 replaces a transition with an
 * opacity cut, and the scale is the only part of a press that moves. The flag is an ARGUMENT
 * because the stylesheet cannot ask for it — `react-native-css@3.0.7` evaluates no
 * `prefers-reduced-motion` query (`source-audit.test.ts` section 49 says where that was read) —
 * so the caller reads `useReducedMotion()` and hands it in.
 *
 * The classes are whole literals: Tailwind finds a class by reading this file as text, and a
 * name assembled from parts would never be compiled.
 *
 * Measured on `Button` on 2026-10-04, from screenshots taken while the finger was down:
 *
 *   - iPhone SE simulator (iOS 26.3, Expo Go): the white fill drops to 0.6 of its value and the
 *     pill to 0.98 of its width (670px to 656px). With Reduce Motion on, an outline pill's
 *     border drops to 0.6 and its width does not change. A `ghost` link drops to 0.6, same width.
 *   - moto g17 (Android 15, dev client): the fill drops to 0.6 and the pill to 0.98 of its
 *     width (980px to 962px). With the transition animation scale at 0 — the setting React
 *     Native reads as Reduce Motion on Android (`AccessibilityInfoModule.kt` in
 *     react-native 0.86.3, read 2026-10-04) — the fill drops to 0.6 and the width does not
 *     change.
 *
 * On the simulator the style was also read off the runtime, on a `Pressable` carrying these
 * classes through `useCssElement`: `opacity: 0.6` and `scaleX`/`scaleY` 0.98 while pressed,
 * neither of them after release.
 */
export const PRESS_DIM = 'active:opacity-60';
const PRESS_PILL = 'active:opacity-60 active:scale-[0.98]';

export function pillPress(reduceMotion: boolean): string {
  return reduceMotion ? PRESS_DIM : PRESS_PILL;
}
