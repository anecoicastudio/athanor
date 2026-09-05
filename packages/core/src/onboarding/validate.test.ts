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
