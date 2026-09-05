import { describe, expect, test } from 'vitest';
import { onboardingAnswersSchema } from './onboarding.ts';

describe('onboardingAnswersSchema', () => {
  const valid = {
    handle: 'lucia_ferri',
    locale: 'it',
    identity_tags: ['coach'],
    seeking: ['connessioni'],
    birth_date: '1990-08-10',
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

describe('onboardingAnswersSchema handle reservation (#430)', () => {
  const valid = {
    handle: 'lucia_ferri',
    locale: 'it',
    identity_tags: ['coach'],
    seeking: ['connessioni'],
    birth_date: '1990-08-10',
  };

  // The write shape refuses a reserved handle; `handleSchema` — which read models use — does
  // not, deliberately. A read schema that grew teeth would start withholding rows the database
  // still holds every time the list is widened.
  test('rejects a reserved handle', () => {
    expect(() => onboardingAnswersSchema.parse({ ...valid, handle: 'supporto' })).toThrow();
  });

  test('rejects a brand-prefixed handle', () => {
    expect(() => onboardingAnswersSchema.parse({ ...valid, handle: 'athanor_support' })).toThrow();
  });

  test('still accepts a handle that merely contains a reserved word', () => {
    expect(onboardingAnswersSchema.parse({ ...valid, handle: 'admin_luna' }).handle).toBe(
      'admin_luna',
    );
  });
});

describe('onboardingAnswersSchema — birth_date (#694)', () => {
  const valid = {
    handle: 'lucia_ferri',
    locale: 'it',
    identity_tags: ['coach'],
    seeking: ['connessioni'],
    birth_date: '1990-08-10',
  };

  test('is required — a new sign-up cannot flush without it', () => {
    const { birth_date: _omitted, ...without } = valid;
    expect(() => onboardingAnswersSchema.parse(without)).toThrow();
  });

  test('rejects a datetime or an impossible day', () => {
    expect(() =>
      onboardingAnswersSchema.parse({ ...valid, birth_date: '1990-08-10T00:00:00Z' }),
    ).toThrow();
    expect(() => onboardingAnswersSchema.parse({ ...valid, birth_date: '2023-02-29' })).toThrow();
  });
});
