import { describe, expect, test } from 'vitest';
import { onboardingAnswersSchema } from './onboarding.ts';

describe('onboardingAnswersSchema', () => {
  const valid = {
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

  test('rejects more than 10 seeking tags', () => {
    expect(() =>
      onboardingAnswersSchema.parse({ ...valid, seeking: Array(11).fill('connessioni') }),
    ).toThrow();
  });
});

/**
 * #782 — the handle is no longer part of what the funnel collects. It used to be derived from the
 * email and flushed with these answers; now the person chooses it on its own screen once the
 * account exists, and it is written by `claimHandle`, never by the flush. A handle that rode this
 * payload would be a name nobody typed.
 */
describe('onboardingAnswersSchema carries no handle (#782)', () => {
  const valid = {
    locale: 'it',
    identity_tags: ['coach'],
    seeking: ['connessioni'],
    birth_date: '1990-08-10',
  };

  test("is exactly the funnel's answers", () => {
    expect(Object.keys(onboardingAnswersSchema.shape).sort()).toEqual([
      'birth_date',
      'identity_tags',
      'locale',
      'seeking',
    ]);
  });

  test('strips a handle rather than passing it to the profile write', () => {
    expect(onboardingAnswersSchema.parse({ ...valid, handle: 'lucia_ferri' })).not.toHaveProperty(
      'handle',
    );
  });
});

describe('onboardingAnswersSchema — birth_date (#694)', () => {
  const valid = {
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
