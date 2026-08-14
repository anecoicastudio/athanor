import { describe, expect, it } from 'vitest';
import { PROFESSIONS, isProfession } from './professions';

/**
 * Curated profession vocabulary (#149, PRD §4.2). Single-select: exactly one
 * key lands in profiles.profession. Keys are stable identifiers; labels live
 * in @athanor/i18n (tag.profession.*). The future affinity term (#123)
 * compares these keys across users — free text would kill it, which is the
 * failure #273 documented for the tag vocabularies.
 */
describe('PROFESSIONS', () => {
  it('holds the 16 stable profession keys', () => {
    expect(PROFESSIONS).toEqual([
      'design',
      'sviluppo',
      'arte',
      'musica',
      'scrittura',
      'foto-video',
      'marketing',
      'comunicazione',
      'business',
      'finanza',
      'legale',
      'educazione',
      'artigianato',
      'ricerca',
      'benessere',
      'food',
    ]);
  });

  it('keys are unique, lowercase and i18n-key safe', () => {
    expect(new Set(PROFESSIONS).size).toBe(PROFESSIONS.length);
    for (const key of PROFESSIONS) {
      expect(key).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe('isProfession', () => {
  it('accepts a vocabulary key', () => {
    expect(isProfession('design')).toBe(true);
  });

  it('rejects free text and near-misses', () => {
    expect(isProfession('designer')).toBe(false);
    expect(isProfession('')).toBe(false);
    expect(isProfession('Design')).toBe(false);
  });
});
