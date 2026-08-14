import { describe, expect, it } from 'vitest';
import { IDENTITY_TAGS, SEEKING_TAGS } from './tags';

/**
 * Characterization of the curated onboarding vocabularies (PRD §4.1). The keys
 * are stored in profiles.identity_tags / profiles.seeking and compared across
 * users by the Momenti matcher, so a renamed or removed key is a data
 * migration, not a copy tweak — this test makes that cost visible.
 */
describe('IDENTITY_TAGS', () => {
  it('holds the stable identity keys', () => {
    expect(IDENTITY_TAGS).toEqual([
      'imprenditore',
      'freelance',
      'coach',
      'artista',
      'creativo',
      'mentor',
      'investitore',
    ]);
  });
});

describe('SEEKING_TAGS', () => {
  it('holds the stable seeking keys', () => {
    expect(SEEKING_TAGS).toEqual([
      'connessioni',
      'collaborazioni',
      'crescita',
      'eventi',
      'business',
      'mentorship',
    ]);
  });
});

describe('vocabulary invariants', () => {
  it.each([
    ['IDENTITY_TAGS', IDENTITY_TAGS],
    ['SEEKING_TAGS', SEEKING_TAGS],
  ] as const)('%s keys are unique, lowercase and i18n-key safe', (_name, keys) => {
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      // Flat dot-namespaced i18n keys (tag.identity.<key>) — no dots, spaces
      // or uppercase inside a key segment.
      expect(key).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
