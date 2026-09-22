/**
 * Dynamic Type policy (#639) — the app's one answer to "how far may text grow?".
 *
 * iOS and Android let a member scale every label; RN's default is `maxFontSizeMultiplier`
 * unset, i.e. unbounded. Unbounded is the RIGHT default for a layout that can grow, and a
 * silent clip for one that cannot — so the policy is two halves, and the geometry half is
 * the one that matters:
 *
 *  1. Boxes that hold text grow (`min-h-*`, wrap, a height derived from `fontScale`).
 *  2. Only where a box genuinely cannot grow — a glyph inside a measured disc — does a cap
 *     stand in, and then the meaning must already be carried by an `accessibilityLabel`.
 *
 * Capping is the LAST resort, never the first: a cap trades legibility for layout, which is
 * exactly the trade an accessibility setting exists to refuse. That is why `ornament` is the
 * only value below 2× and why it is documented per call site.
 *
 * WCAG 2.1 SC 1.4.4 (A-6 / G2 — `docs/RELEASE-RUNBOOK.md` §G2) asks for 200% without loss of
 * content or function, so `text` is exactly 2 and nothing in the app may cap ordinary prose
 * tighter than that.
 */
export const FONT_SCALE_CAP = {
  /**
   * Every `Text` / `TextInput` in the app, applied once in `src/tw`. 2× is the WCAG 200%
   * floor — a call site may raise it, and may only lower it to one of the values below.
   */
  text: 2,
  /**
   * Numerals that are ALREADY display-sized and sit in a cell whose width is fixed by
   * division (`flex-1` countdown cells): the fund countdown, the annual clock. At 1.35 a
   * 26pt numeral reaches ~35pt — still larger than body text at 2×, whichever body: 32pt
   * from DESIGN §4's 16pt web scale, and ~28pt on device, where this app's body is 13-14px
   * and `rem` inlines at 14. The hierarchy survives and the digits never leave their cell.
   */
  display: 1.35,
  /**
   * A glyph that is decoration: an avatar's initial, a ✕ on a measured 20pt badge. Its
   * meaning is on the parent's `accessibilityLabel`, so a screen reader loses nothing and
   * scaling it would only push it out of a disc whose size is a layout constant.
   * Never valid on text a member has to read.
   */
  ornament: 1,
} as const;

/**
 * Height for a well whose children are absolutely positioned, so their own text can never
 * grow it (the Momenti swipe deck: `SwipeDeck` stacks `absolute inset-0` cards, so the
 * parent's fixed height is the only height there is).
 *
 * Scales the base with the member's `fontScale` and bounds it by the same 2× the text cap
 * uses, so the well and the text inside it stop growing together. Below 1 it returns the
 * base unchanged: a member who SHRINKS text is asking for more content per screen, not for
 * a smaller card.
 */
export function scaledWellHeight(
  base: number,
  fontScale: number,
  cap: number = FONT_SCALE_CAP.text,
): number {
  if (!Number.isFinite(fontScale)) return base;
  return Math.round(base * Math.min(Math.max(fontScale, 1), cap));
}

/**
 * The Momenti deck well at the default text size is at most 438pt (DESIGN §8.4, #751). On a
 * phone whose screen leaves less room than that under the header, 438 pushed «Passa» /
 * «Connetti» under the tab bar (iPhone SE, 375×667), so 438 is a ceiling, not a size.
 */
export const DECK_WELL_MAX = 438;

/**
 * The floor the well never shrinks under. At the default text size it rarely binds — an
 * iPhone SE leaves ~426 — so it is chosen for the LARGEST text size, where the header and the
 * action row grow and eat the room while the card's text wraps faster than it scales. Measured
 * on an iPhone SE at AX5 (fontScale capped at 2×): a card with three reasons and a two-line
 * dream needs ~646pt, i.e. a base of ~323; 300 clipped its quote. 380 → 760 at 2× leaves
 * ~114pt, about three more lines of AX quote. It stays under the SE's default-size room, so
 * the fit #751 exists for is not traded away.
 */
export const DECK_WELL_MIN = 380;

/**
 * Height of the Momenti deck well, from what the screen actually has (#751). Every input is
 * MEASURED by the screen, never a guessed inset:
 *
 *  - `viewport`: the ScrollView's own height. The tab bar is a flow sibling below `Screen`
 *    and `Screen` owns the safe-area insets, so both are already outside it — subtracting
 *    them again would reserve them twice.
 *  - `wellTop`: the well's `y` in the scroll content — everything above it (padding, the
 *    suspension banner's absence or presence, the eyebrow, the h1) in one number.
 *  - `actionGap` + `actionRow`: the margin above the Passa / Connetti row and its height.
 *
 * The room left is clamped to `[DECK_WELL_MIN, DECK_WELL_MAX]` and only THEN multiplied by
 * `fontScale` through `scaledWellHeight`, so at a large text size the well still grows past
 * the viewport and the screen scrolls (#639). Before the first measurement `viewport` is
 * undefined and the answer is the maximum — the size every phone got before #751.
 */
export function deckWellHeight({
  viewport,
  wellTop,
  actionGap,
  actionRow,
  fontScale,
}: {
  viewport: number | undefined;
  wellTop: number;
  actionGap: number;
  actionRow: number;
  fontScale: number;
}): number {
  if (viewport === undefined || !Number.isFinite(viewport)) {
    return scaledWellHeight(DECK_WELL_MAX, fontScale);
  }
  const room = viewport - wellTop - actionGap - actionRow;
  const base = Math.min(Math.max(room, DECK_WELL_MIN), DECK_WELL_MAX);
  return scaledWellHeight(Math.floor(base), fontScale);
}
