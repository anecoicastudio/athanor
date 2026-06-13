import { describe, expect, it } from 'vitest';
import { COMPLETENESS_WEIGHTS, profileCompleteness } from './completeness';

const empty = {
  handle: null,
  bio: null,
  identity_tags: [] as string[],
  seeking: [] as string[],
  hasDream: false,
};

describe('profileCompleteness', () => {
  it('is 0 for an empty profile', () => {
    expect(profileCompleteness(empty)).toBe(0);
  });

  it('counts the handle alone', () => {
    expect(profileCompleteness({ ...empty, handle: 'marco' })).toBe(COMPLETENESS_WEIGHTS.handle);
  });

  it('reaches at least 0.70 once the profile is minimally complete (handle + identity + seeking)', () => {
    // PRD §4.1: complete = handle + ≥1 identity + ≥1 seeking. M1 acceptance is ≥70%.
    const minimal = {
      ...empty,
      handle: 'marco',
      identity_tags: ['imprenditore'],
      seeking: ['connessioni'],
    };
    expect(profileCompleteness(minimal)).toBeGreaterThanOrEqual(0.7);
  });

  it('adds bio and dream on top of the required trio, capping at 1', () => {
    const full = {
      handle: 'marco',
      bio: 'Costruisco cose.',
      identity_tags: ['imprenditore'],
      seeking: ['connessioni'],
      hasDream: true,
    };
    expect(profileCompleteness(full)).toBe(1);
  });

  it('ignores a blank/whitespace bio', () => {
    const withBlankBio = {
      handle: 'marco',
      bio: '   ',
      identity_tags: ['imprenditore'],
      seeking: ['connessioni'],
      hasDream: false,
    };
    const withoutBio = { ...withBlankBio, bio: null };
    expect(profileCompleteness(withBlankBio)).toBe(profileCompleteness(withoutBio));
  });

  it('weights sum to 1', () => {
    const total = Object.values(COMPLETENESS_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1);
  });
});
