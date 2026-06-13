import { describe, expect, it } from 'vitest';
import { auraSnapshotSchema, STAR_KEYS, ZERO_AURA_SNAPSHOT } from './aura';

describe('aura snapshot', () => {
  it('has the six canonical stars (PRD §4.10 order)', () => {
    expect(STAR_KEYS).toEqual([
      'visionario',
      'mentor',
      'collaboratore',
      'creatore',
      'innovatore',
      'ambasciatore',
    ]);
  });

  it('parses a well-formed snapshot', () => {
    const r = auraSnapshotSchema.safeParse(ZERO_AURA_SNAPSHOT);
    expect(r.success).toBe(true);
  });

  it('zero snapshot is score 0 with every star unlit', () => {
    expect(ZERO_AURA_SNAPSHOT.score).toBe(0);
    expect(Object.values(ZERO_AURA_SNAPSHOT.stars).every((v) => v === false)).toBe(true);
  });

  it('rejects a negative score', () => {
    expect(auraSnapshotSchema.safeParse({ ...ZERO_AURA_SNAPSHOT, score: -1 }).success).toBe(false);
  });
});
