import { describe, expect, test } from 'vitest';
import { dreamInsertSchema } from './dream';
import { onboardingAnswersSchema } from './onboarding';

describe('onboardingAnswersSchema', () => {
  const valid = {
    handle: 'lucia_ferri',
    locale: 'it',
    identity_tags: ['coach'],
    seeking: ['connessioni'],
  };

  test('accepts a valid payload', () => {
    expect(onboardingAnswersSchema.parse(valid)).toEqual(valid);
  });

  test('rejects empty identity_tags', () => {
    expect(() => onboardingAnswersSchema.parse({ ...valid, identity_tags: [] })).toThrow();
  });

  test('rejects empty seeking', () => {
    expect(() => onboardingAnswersSchema.parse({ ...valid, seeking: [] })).toThrow();
  });

  test('rejects more than 10 tags', () => {
    expect(() =>
      onboardingAnswersSchema.parse({ ...valid, identity_tags: Array(11).fill('coach') }),
    ).toThrow();
  });

  test('rejects invalid handle', () => {
    expect(() => onboardingAnswersSchema.parse({ ...valid, handle: 'No Spaces!' })).toThrow();
  });
});

describe('dreamInsertSchema', () => {
  test('accepts text up to 500 chars', () => {
    expect(
      dreamInsertSchema.parse({
        profile_id: '2e9c0a52-0b1e-4d1f-9c39-1d6a3a111111',
        text: 'x'.repeat(500),
      }),
    ).toBeTruthy();
  });

  test('rejects text over 500 chars', () => {
    expect(() =>
      dreamInsertSchema.parse({
        profile_id: '2e9c0a52-0b1e-4d1f-9c39-1d6a3a111111',
        text: 'x'.repeat(501),
      }),
    ).toThrow();
  });

  test('rejects blank text', () => {
    expect(() =>
      dreamInsertSchema.parse({ profile_id: '2e9c0a52-0b1e-4d1f-9c39-1d6a3a111111', text: '   ' }),
    ).toThrow();
  });
});
