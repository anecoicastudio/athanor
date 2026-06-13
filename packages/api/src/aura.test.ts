import { describe, expect, it } from 'vitest';
import { auraKeys, getAuraScore } from './aura';

describe('aura api', () => {
  it('key factory shape', () => {
    expect(auraKeys.detail('abc')).toEqual(['aura', 'detail', 'abc']);
  });

  it('returns the coalesced zero-snapshot in M1 (never null)', async () => {
    const snap = await getAuraScore({} as never, 'abc');
    expect(snap.score).toBe(0);
    expect(Object.values(snap.stars).every((v) => v === false)).toBe(true);
  });
});
