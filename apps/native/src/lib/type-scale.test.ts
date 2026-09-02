import { describe, expect, it } from 'vitest';
import { FONT_SCALE_CAP, scaledWellHeight } from './type-scale';

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
