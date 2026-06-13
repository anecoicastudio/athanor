import type { OnboardingAnswers } from '@auria/schemas';
import { IDENTITY_TAGS, SEEKING_TAGS } from './tags';

export type OnboardingValidation = { ok: true } | { ok: false; field: 'identity_tags' | 'seeking' };

/** Vocabulary membership check — zod (schemas) handles shape, this handles meaning. */
export function validateOnboardingAnswers(answers: OnboardingAnswers): OnboardingValidation {
  const identityOk = answers.identity_tags.every((tag) =>
    (IDENTITY_TAGS as readonly string[]).includes(tag),
  );
  if (!identityOk) return { ok: false, field: 'identity_tags' };
  const seekingOk = answers.seeking.every((tag) =>
    (SEEKING_TAGS as readonly string[]).includes(tag),
  );
  if (!seekingOk) return { ok: false, field: 'seeking' };
  return { ok: true };
}
