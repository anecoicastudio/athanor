/**
 * The decision half of the composer dirty-state guard (#636).
 *
 * Every composer in the app used to lose typed work in silence: one swipe down on an iOS sheet
 * (or one tap on the header chevron) discarded a typed dream, a post body with up to ten staged
 * media, a seven-step candidacy wizard. `useGuardedBack` (`src/lib/modal-exit.ts`) is a
 * DEAD-END guard — it answers "where does this screen exit to", never "may it exit at all" —
 * so nothing in the tree stood between a gesture and the draft.
 *
 * This module is the part of the answer that is a pure function, and it lives apart from the
 * hook for the reason `src/lib/media/audio-recording.ts` states about `Platform.OS`: a decision
 * taken as an argument is a decision a node-environment test can reach. `use-dirty-guard.ts`
 * imports `expo-router/react-navigation` and `react-native`, neither of which this harness can
 * collect (`vitest.config.ts` runs `environment: 'node'` over `src/**\/*.test.ts`, and
 * react-native ships untranspiled Flow), so everything worth asserting is here instead.
 */

/**
 * A value a composer holds in `useState` and could lose: the strings, enums, toggles, dates,
 * staged-media arrays and nested wizard objects the roster actually stores.
 *
 * Deliberately structural rather than `unknown`: the comparator below walks whatever it is
 * handed, and naming the shapes is what stops a caller passing a function or a class instance
 * and quietly getting `true` on every render.
 */
export type DraftValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | readonly DraftValue[]
  | { readonly [key: string]: DraftValue };

/**
 * A nested draft object — anything that is not an array, a `Date` or a primitive. A guard
 * rather than a cast, so the narrowing below is checked rather than asserted.
 */
function isRecord(value: DraftValue): value is { readonly [key: string]: DraftValue } {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

/**
 * Nothing-was-typed, in every spelling a composer produces.
 *
 * `''`, `null`, `undefined` and `[]` all mean the same thing to a member, and they mix freely
 * across a baseline/current pair: a field mounts as `''` while the row it was captured from
 * held `null`, and an untouched media tray is `[]` on one side and `undefined` on the other.
 * Treating them as distinct is what makes a guard cry wolf on a screen the member only opened,
 * and a guard that fires on nothing is one the member learns to dismiss without reading.
 *
 * `false` and `0` are NOT empty — they are values a member chose (an event toggled to free, a
 * capacity typed as zero).
 */
function isEmpty(value: DraftValue): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Structural comparison, bounded by depth.
 *
 * The bound is the whole cycle story: a draft that refers to itself stops at `depth` rather
 * than exhausting the stack. A composer should never build one, but this runs inside a
 * dismissal gesture, and a comparator that throws turns "confirm before you lose this" into a
 * crash — a worse failure than the one being fixed.
 */
function equal(a: DraftValue, b: DraftValue, depth: number): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (isEmpty(a) !== isEmpty(b)) return false;

  // Past a sane draft's nesting, call it equal rather than recurse: a deeper difference is not
  // work a member typed into a composer, and a runaway walk is a frozen screen.
  if (depth > 12) return true;

  if (a instanceof Date || b instanceof Date) {
    if (!(a instanceof Date) || !(b instanceof Date)) return false;
    // Two invalid dates compare equal: NaN !== NaN would report a re-render as an edit.
    const [x, y] = [a.getTime(), b.getTime()];
    return Number.isNaN(x) && Number.isNaN(y) ? true : x === y;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, i) => equal(item, b[i], depth + 1));
  }

  if (isRecord(a) || isRecord(b)) {
    if (!isRecord(a) || !isRecord(b)) return false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (!equal(a[key], b[key], depth + 1)) return false;
    }
    return true;
  }

  if (typeof a === 'string' && typeof b === 'string') return a.trim() === b.trim();

  // Different primitive types are different values — `'1'` is not `1`.
  return Object.is(a, b);
}

/**
 * Has the member put work into this composer that closing it would destroy?
 *
 * `baseline` is what the screen opened with — the constant a create-flow mounts with, or the
 * row an edit-flow loaded. `current` is what it holds now. Capture the baseline once the
 * screen has loaded, never before: comparing a typed draft against a not-yet-arrived row
 * reports every edit screen as dirty from its first keystroke.
 */
export function isDraftDirty(baseline: DraftValue, current: DraftValue): boolean {
  return !equal(baseline, current, 0);
}

/** Everything the guard needs to decide whether to stand in front of a dismissal. */
export interface ExitGuardState {
  /** `isDraftDirty(baseline, current)` for this screen. */
  dirty: boolean;
  /** A write is in flight. */
  saving: boolean;
  /** The write landed; the screen is on its way out under its own power. */
  submitted: boolean;
  /** `Platform.OS`, taken as an argument so this stays a pure decision. */
  platformOS: string;
}

/**
 * Whether a dismissal should be intercepted and confirmed.
 *
 * Three ways to answer no, and each is load-bearing:
 *
 * - **`saving` / `submitted`.** A composer's own success path pops the screen while the fields
 *   still hold what was just written — `dream-editor.tsx` does it on a `setTimeout(leave, 700)`
 *   behind its toast. `dirty` is still true there, so a guard that read only `dirty` would ask
 *   the member to confirm discarding work that is already stored. That is not a rough edge; it
 *   would make the guard fire most often on the one path where nothing is at stake.
 * - **web.** `Alert.alert` is a no-op stub on react-native-web. Preventing the pop and then
 *   showing nothing leaves the member on a screen with no way out at all, which is worse than
 *   the silent discard this guard exists to stop. react-native-web is this project's QA
 *   harness rather than a shipped surface, so it keeps today's behaviour and its exits.
 */
export function shouldGuardExit(state: ExitGuardState): boolean {
  if (state.platformOS === 'web') return false;
  return state.dirty && !state.saving && !state.submitted;
}
