import { describe, expect, test } from 'vitest';
import { suggestHandle } from './handle';

describe('suggestHandle', () => {
  test('uses the email local part lowercased', () => {
    expect(suggestHandle('Lucia.Ferri@example.com')).toBe('lucia_ferri');
  });

  test('replaces invalid characters with underscore', () => {
    expect(suggestHandle('lucia+athanor@example.com')).toBe('lucia_athanor');
  });

  test('collapses consecutive underscores', () => {
    expect(suggestHandle('l..u@example.com')).toBe('l_u');
  });

  // The case above collapses underscores the previous replace *produced*. Underscores already
  // present in the address are the ones that reach the `/_+/g` pass as a run, and nothing
  // covered them — so narrowing that pattern to a single `_` went unnoticed.
  test('collapses underscores the address itself contains', () => {
    expect(suggestHandle('l__u@example.com')).toBe('l_u');
  });

  // Nothing produced a leading or trailing underscore either, so the final trim was untested.
  test('trims leading and trailing underscores', () => {
    expect(suggestHandle('.lucia.@example.com')).toBe('lucia');
  });

  test('pads to minimum 3 chars', () => {
    expect(suggestHandle('ab@example.com')).toBe('ab_');
  });

  test('truncates to 30 chars', () => {
    expect(suggestHandle(`${'a'.repeat(40)}@example.com`)).toBe('a'.repeat(30));
  });

  test('falls back for empty local part', () => {
    expect(suggestHandle('@example.com')).toBe('aura');
  });
});
