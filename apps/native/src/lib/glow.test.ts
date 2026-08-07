import { semantic } from '@athanor/config';
import { describe, expect, it } from 'vitest';
import { auraGlow } from './glow';

describe('auraGlow', () => {
  it('level 0 or below → no glow at all', () => {
    expect(auraGlow(0)).toEqual({});
    expect(auraGlow(-1)).toEqual({});
  });

  it('level 1 → full Foundation §3 recipe on the aura token', () => {
    expect(auraGlow(1)).toEqual({
      shadowColor: semantic.aura,
      shadowOpacity: 0.45,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 0 },
      elevation: 12,
    });
  });

  it('scales opacity/radius linearly and rounds elevation', () => {
    const half = auraGlow(0.5);
    expect(half.shadowOpacity).toBeCloseTo(0.225);
    expect(half.shadowRadius).toBe(12);
    expect(half.elevation).toBe(6);

    const partial = auraGlow(0.3);
    expect(partial.shadowOpacity).toBeCloseTo(0.135);
    expect(partial.shadowRadius).toBeCloseTo(7.2);
    expect(partial.elevation).toBe(4); // round(3.6)
  });
});
