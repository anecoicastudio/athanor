import { describe, expect, test } from 'vitest';
import { RESERVED_HANDLES, isReservedHandle } from '@athanor/schemas';
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

/**
 * #430 — the generator has to dodge the reserved list BEFORE the database learns to refuse it.
 * `flushOnboardingDraft` parses its payload with `onboardingAnswersSchema`, so a reserved
 * suggestion throws inside the flush, which keeps the draft and retries on every foreground —
 * a permanent onboarding loop for anyone whose address begins `admin@`. And past the schema the
 * CHECK raises 23514, which `updateOnboardingProfileWithHandleFallback` does not retry (it
 * catches 23505 only).
 */
describe('suggestHandle avoids reserved handles', () => {
  test('suffixes a listed handle rather than emitting it', () => {
    expect(suggestHandle('admin@example.com')).toBe('admin_');
  });

  test('suffixes an Italian role word too', () => {
    expect(suggestHandle('supporto@example.com')).toBe('supporto_');
  });

  test('falls back entirely for a brand-prefixed local part', () => {
    // A suffix cannot escape a PREFIX rule — `athanor_support_` still starts with `athanor`.
    expect(suggestHandle('athanor.support@example.com')).toBe('aura');
  });

  test('never emits a reserved handle, for any reserved local part', () => {
    for (const reserved of RESERVED_HANDLES) {
      const suggested = suggestHandle(`${reserved}@example.com`);
      expect(isReservedHandle(suggested), reserved).toBe(false);
      expect(suggested.length, reserved).toBeLessThanOrEqual(30);
    }
  });

  test('keeps the result within the 30-char cap when suffixing a long brand handle', () => {
    expect(suggestHandle(`athanor${'a'.repeat(40)}@example.com`)).toBe('aura');
  });
});
