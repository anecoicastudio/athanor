import { describe, expect, test } from 'vitest';
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

  test('rejects more than 10 seeking tags', () => {
    expect(() =>
      onboardingAnswersSchema.parse({ ...valid, seeking: Array(11).fill('connessioni') }),
    ).toThrow();
  });
});
