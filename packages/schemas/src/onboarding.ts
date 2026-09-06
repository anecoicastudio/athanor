import { z } from 'zod';
import { claimableHandleSchema, localeSchema } from './profile.ts';
import { birthDateSchema } from './zodiac.ts';

/**
 * Onboarding payload. Tag values are generic strings here; membership in the
 * curated vocabularies is enforced by @athanor/core (validateOnboardingAnswers)
 * so the vocabulary has a single source. Max 10 mirrors the DB check.
 *
 * `birth_date` is REQUIRED here and nowhere else (#694): this schema is what a NEW sign-up's
 * draft is flushed through, so it is the one place requiredness belongs. The column itself is
 * nullable and `isProfileComplete` ignores it — a pre-#694 member must not be routed back
 * into the funnel. The 14+ floor is @athanor/core's `isAtLeastAge` (needs a clock) plus the
 * DB trigger; shape alone cannot know today's date.
 */
export const onboardingAnswersSchema = z.object({
  // `claimableHandleSchema`, not `handleSchema`: this is a claim (#430).
  handle: claimableHandleSchema,
  locale: localeSchema,
  identity_tags: z.array(z.string().min(1)).min(1).max(10),
  seeking: z.array(z.string().min(1)).min(1).max(10),
  birth_date: birthDateSchema,
});

export type OnboardingAnswers = z.infer<typeof onboardingAnswersSchema>;
