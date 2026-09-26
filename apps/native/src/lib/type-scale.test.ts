import { describe, expect, it } from 'vitest';
import {
  DECK_WELL_MAX,
  DECK_WELL_MIN,
  FONT_SCALE_CAP,
  STACK_TRAILING_AT,
  deckWellHeight,
  scaledWellHeight,
  stacksTrailing,
} from './type-scale';

describe('the Dynamic Type caps (#639)', () => {
  it('lets ordinary text reach the WCAG 200% floor', () => {
    // A-6 / G2 asks for 200% without loss of content. A `text` cap below 2 would put the
    // whole app under that floor in one edit, which is the regression worth failing on.
    expect(FONT_SCALE_CAP.text).toBeGreaterThanOrEqual(2);
  });

  it('keeps a capped display numeral larger than 2x-scaled body text', () => {
    // The `display` cap exists so digits stay inside a divided cell — not so they shrink
    // below the prose around them. A 26pt numeral at `display` must still beat body text at
    // 2x. Asserted against 16 — DESIGN §4's web body, the LARGER of the two — because this
    // app's own body is 13-14px on device, so clearing 16 clears that with room to spare.
    expect(26 * FONT_SCALE_CAP.display).toBeGreaterThan(16 * FONT_SCALE_CAP.text);
  });

  it('never scales an ornament', () => {
    expect(FONT_SCALE_CAP.ornament).toBe(1);
  });

  it('orders the three caps', () => {
    expect(FONT_SCALE_CAP.ornament).toBeLessThan(FONT_SCALE_CAP.display);
    expect(FONT_SCALE_CAP.display).toBeLessThan(FONT_SCALE_CAP.text);
  });
});

describe('scaledWellHeight (#639)', () => {
  it('returns the base at the default scale', () => {
    expect(scaledWellHeight(438, 1)).toBe(438);
  });

  it('grows with the member’s text size', () => {
    expect(scaledWellHeight(438, 1.5)).toBe(657);
  });

  it('stops growing at the same cap the text stops at', () => {
    expect(scaledWellHeight(438, 3.12)).toBe(438 * FONT_SCALE_CAP.text);
    expect(scaledWellHeight(438, 99)).toBe(438 * FONT_SCALE_CAP.text);
  });

  it('never shrinks below the base', () => {
    // A member scaling text DOWN wants more content per screen, not a smaller card.
    expect(scaledWellHeight(438, 0.82)).toBe(438);
    expect(scaledWellHeight(438, 0)).toBe(438);
  });

  it('accepts a tighter cap than the text default', () => {
    expect(scaledWellHeight(200, 3, 1.5)).toBe(300);
  });

  it('rounds to a whole point', () => {
    expect(Number.isInteger(scaledWellHeight(438, 1.35))).toBe(true);
  });

  it('falls back to the base when the platform reports no usable scale', () => {
    // `useWindowDimensions().fontScale` is typed non-nullable but comes from the native
    // side; NaN here would propagate into a style height and blank the deck.
    expect(scaledWellHeight(438, Number.NaN)).toBe(438);
    expect(scaledWellHeight(438, Number.POSITIVE_INFINITY)).toBe(438);
  });
});

describe('deckWellHeight (#751)', () => {
  // An iPhone SE (375×667) Momenti tab, measured shapes: the ScrollView's viewport is the
  // window minus the status bar (20) and the tab bar (49) — both outside it, so the helper
  // never sees them. The well sits below pt-4 + eyebrow + h1 + sub + mt-5; the action row
  // is a 56pt button behind its own mt-5.
  const SE = { viewport: 598, wellTop: 112, actionGap: 20, actionRow: 56 };

  it('keeps 438 on a large window at the default text size', () => {
    // iPhone 17 Pro Max: nothing about a phone that already fit may change.
    expect(deckWellHeight({ ...SE, viewport: 800, fontScale: 1 })).toBe(438);
    expect(DECK_WELL_MAX).toBe(438);
  });

  it('shrinks on a 667pt window so the action row stays above the tab bar', () => {
    const well = deckWellHeight({ ...SE, fontScale: 1 });
    expect(well).toBeLessThan(DECK_WELL_MAX);
    expect(SE.wellTop + well + SE.actionGap + SE.actionRow).toBeLessThanOrEqual(SE.viewport);
    expect(well).toBe(410);
  });

  it('never goes below the minimum, however little room there is', () => {
    expect(deckWellHeight({ ...SE, viewport: 320, fontScale: 1 })).toBe(DECK_WELL_MIN);
    expect(deckWellHeight({ ...SE, viewport: 0, fontScale: 1 })).toBe(DECK_WELL_MIN);
  });

  it('applies fontScale after the clamp, so #639’s large-text growth holds', () => {
    expect(deckWellHeight({ ...SE, fontScale: 1.5 })).toBe(615);
    expect(deckWellHeight({ ...SE, viewport: 800, fontScale: 1.5 })).toBe(657);
    expect(deckWellHeight({ ...SE, viewport: 0, fontScale: 2 })).toBe(
      DECK_WELL_MIN * FONT_SCALE_CAP.text,
    );
  });

  it('falls back to the maximum until the screen has been measured', () => {
    expect(deckWellHeight({ ...SE, viewport: undefined, fontScale: 1 })).toBe(DECK_WELL_MAX);
    expect(deckWellHeight({ ...SE, viewport: Number.NaN, fontScale: 1 })).toBe(DECK_WELL_MAX);
  });

  it('never exceeds 438 at the default text size, and a smaller text size does not shrink it', () => {
    expect(deckWellHeight({ ...SE, viewport: 5000, fontScale: 1 })).toBe(DECK_WELL_MAX);
    expect(deckWellHeight({ ...SE, fontScale: 0.82 })).toBe(410);
  });

  it('rounds to a whole point', () => {
    expect(Number.isInteger(deckWellHeight({ ...SE, viewport: 598.5, fontScale: 1.35 }))).toBe(
      true,
    );
  });
});

describe('stacksTrailing (#847)', () => {
  it('keeps the trailing chip beside the text at every non-accessibility size', () => {
    // iOS tops out at ~1.35 before the AX sizes; Android's steps below 1.5 are 1.15 and 1.3.
    // A chip that dropped to its own line here would change the default-size layout.
    for (const scale of [0.82, 1, 1.15, 1.3, 1.35]) expect(stacksTrailing(scale)).toBe(false);
  });

  it('drops it under the text from the first accessibility size up', () => {
    // iOS AX1 ~1.65, AX5 ~3.1 (rendered at the 2x cap); Android 1.5, 1.8, 2.0.
    for (const scale of [STACK_TRAILING_AT, 1.65, 1.8, 2, 3.12]) {
      expect(stacksTrailing(scale)).toBe(true);
    }
  });

  it('keeps the default layout when the scale is unknown', () => {
    expect(stacksTrailing(Number.NaN)).toBe(false);
  });
});
