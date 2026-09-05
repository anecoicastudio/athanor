import type { OnboardingAnswers } from '@athanor/schemas';
import { parseBirthDate } from '../profile/zodiac';
import { IDENTITY_TAGS, SEEKING_TAGS } from './tags';

export type OnboardingValidation =
  | { ok: true }
  | { ok: false; field: 'identity_tags' | 'seeking' | 'birth_date' };

/**
 * Meaning check — zod (schemas) handles shape, this handles what the shape cannot know:
 * vocabulary membership for the tags, and for `birth_date` (#694) that the day exists at all
 * (`2023-02-29` is well-formed and not a day). Age is deliberately NOT here: it needs a clock,
 * which `isAtLeastAge` takes as a parameter, and the DB trigger enforces it regardless.
 */
export function validateOnboardingAnswers(answers: OnboardingAnswers): OnboardingValidation {
  const identityOk = answers.identity_tags.every((tag) =>
    (IDENTITY_TAGS as readonly string[]).includes(tag),
  );
  if (!identityOk) return { ok: false, field: 'identity_tags' };
  const seekingOk = answers.seeking.every((tag) =>
    (SEEKING_TAGS as readonly string[]).includes(tag),
  );
  if (!seekingOk) return { ok: false, field: 'seeking' };
  if (parseBirthDate(answers.birth_date) === null) return { ok: false, field: 'birth_date' };
  return { ok: true };
}
