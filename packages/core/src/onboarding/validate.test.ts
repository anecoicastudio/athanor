import { describe, expect, test } from 'vitest';
import { validateOnboardingAnswers } from './validate';

const valid = {
  handle: 'lucia',
  locale: 'it' as const,
  identity_tags: ['coach'],
  seeking: ['connessioni'],
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
});
