import { describe, expect, test } from 'vitest';
import { isProfileComplete } from './complete';

describe('isProfileComplete', () => {
  const complete = { handle: 'marco', identity_tags: ['imprenditore'], seeking: ['connessioni'] };

  test('true when handle + at least one tag each', () => {
    expect(isProfileComplete(complete)).toBe(true);
  });

  test('false when handle missing', () => {
    expect(isProfileComplete({ ...complete, handle: null })).toBe(false);
  });

  test('false when identity_tags empty', () => {
    expect(isProfileComplete({ ...complete, identity_tags: [] })).toBe(false);
  });

  test('false when seeking empty', () => {
    expect(isProfileComplete({ ...complete, seeking: [] })).toBe(false);
  });
});
