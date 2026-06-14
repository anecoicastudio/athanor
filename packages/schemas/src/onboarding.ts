import { z } from 'zod';
import { handleSchema, localeSchema } from './profile';

/**
 * Onboarding payload. Tag values are generic strings here; membership in the
 * curated vocabularies is enforced by @athanor/core (validateOnboardingAnswers)
 * so the vocabulary has a single source. Max 10 mirrors the DB check.
 */
export const onboardingAnswersSchema = z.object({
  handle: handleSchema,
  locale: localeSchema,
  identity_tags: z.array(z.string().min(1)).min(1).max(10),
  seeking: z.array(z.string().min(1)).min(1).max(10),
});

export type OnboardingAnswers = z.infer<typeof onboardingAnswersSchema>;
