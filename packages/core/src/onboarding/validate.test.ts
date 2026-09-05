import { describe, expect, test } from 'vitest';
import { validateOnboardingAnswers } from './validate';

const valid = {
  handle: 'lucia',
  locale: 'it' as const,
  identity_tags: ['coach'],
  seeking: ['connessioni'],
  birth_date: '1990-08-10',
};

describe('validateOnboardingAnswers', () => {
  test('accepts tags from the curated vocabularies', () => {
    expect(validateOnboardingAnswers(valid)).toEqual({ ok: true });
  });

  test('rejects identity tags outside the vocabulary', () => {
    expect(validateOnboardingAnswers({ ...valid, identity_tags: ['hacker'] })).toEqual({
      ok: false,
      field: 'identity_tags',
    });
  });

  test('rejects seeking tags outside the vocabulary', () => {
    expect(validateOnboardingAnswers({ ...valid, seeking: ['fama'] })).toEqual({
      ok: false,
      field: 'seeking',
    });
  });

  // Both rejection cases above pass an array where EVERY tag is invalid, and `every` and `some`
  // agree on all-valid and all-invalid inputs alike — so the check could have been `some` (accept
  // if any tag is known) and the suite would not have noticed. A mixed array is the only input
  // that separates them, and it is also the realistic one: a client sending one good tag
  // alongside one off-vocabulary tag must be rejected, not waved through.
  test('rejects a mixed array — one bad tag is enough', () => {
    expect(validateOnboardingAnswers({ ...valid, identity_tags: ['coach', 'hacker'] })).toEqual({
      ok: false,
      field: 'identity_tags',
    });
    expect(validateOnboardingAnswers({ ...valid, seeking: ['connessioni', 'fama'] })).toEqual({
      ok: false,
      field: 'seeking',
    });
  });
});

describe('validateOnboardingAnswers — birth_date (#694)', () => {
  // Shape (`YYYY-MM-DD`) is zod's; MEANING — is this a day that exists — is this layer's, the
  // same split as tags. Age is neither: it needs a clock (`isAtLeastAge`, injected) and the
  // DB trigger, so a 13-year-old's real birthday passes here on purpose.
  test('rejects a date that is not a real calendar day', () => {
    expect(validateOnboardingAnswers({ ...valid, birth_date: '2023-02-29' })).toEqual({
      ok: false,
      field: 'birth_date',
    });
  });

  test('checks the date AFTER the vocabularies — a bad tag is reported first', () => {
    expect(
      validateOnboardingAnswers({ ...valid, identity_tags: ['hacker'], birth_date: '2023-02-29' }),
    ).toEqual({ ok: false, field: 'identity_tags' });
  });
});
