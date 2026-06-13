import { describe, expect, it } from 'vitest';
import { auraGlowLevel } from './glow';

describe('auraGlowLevel', () => {
  it('is 0 for a new user (read-only seed score 0)', () => {
    expect(auraGlowLevel(0)).toBe(0);
  });
  it('is 0 for negative / non-finite input (defensive)', () => {
    expect(auraGlowLevel(-50)).toBe(0);
    expect(auraGlowLevel(Number.NaN)).toBe(0);
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
