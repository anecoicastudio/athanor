import { describe, expect, it } from 'vitest';
import { auraGlowLevel } from './glow';

describe('auraGlowLevel', () => {
  it('is 0 for a new user (read-only seed score 0)', () => {
    expect(auraGlowLevel(0)).toBe(0);
  });
  it('is 0 for negative / non-finite input (defensive)', () => {
    expect(auraGlowLevel(-50)).toBe(0);
    expect(auraGlowLevel(Number.NaN)).toBe(0);
    // +Infinity is the only non-finite input the tier loop would otherwise light: it clears
    // every `min`, so without the isFinite guard it returns the top tier instead of 0. NaN and
    // -Infinity fall through to 0 on their own, which is why the guard looked untested — so
    // this one line is the whole point, and a -Infinity case here would add nothing that
    // `auraGlowLevel(-50)` above does not already cover.
    expect(auraGlowLevel(Number.POSITIVE_INFINITY)).toBe(0);
  });
  it('brightens by tier', () => {
    expect(auraGlowLevel(1)).toBe(0.4);
    expect(auraGlowLevel(250)).toBe(0.6);
    expect(auraGlowLevel(999)).toBe(0.8);
    expect(auraGlowLevel(500)).toBe(0.8);
    expect(auraGlowLevel(1000)).toBe(1);
    expect(auraGlowLevel(99999)).toBe(1);
  });
});
