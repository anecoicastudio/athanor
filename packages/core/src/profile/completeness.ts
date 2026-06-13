/**
 * Profile completeness for the M1 acceptance criterion (PRD §4.1: ≥70% complete).
 * Pure — the caller injects `hasDream` (the dream lives in a separate table).
 *
 * The required trio (handle + ≥1 identity + ≥1 seeking) is what `isProfileComplete`
 * gates on; its weights sum to 0.75 so a minimally-complete profile already reads ≥70%.
 * Bio and dream are the remaining encouragement.
 */
export type ProfileCompletenessInput = {
  handle: string | null;
  bio: string | null;
  identity_tags: string[];
  seeking: string[];
  hasDream: boolean;
};

export const COMPLETENESS_WEIGHTS = {
  handle: 0.25,
  identity: 0.25,
  seeking: 0.25,
  bio: 0.15,
  dream: 0.1,
} as const;

/** Returns a 0–1 ratio, rounded to two decimals (avoids float dust in the UI). */
export function profileCompleteness(input: ProfileCompletenessInput): number {
  let score = 0;
  if (input.handle) score += COMPLETENESS_WEIGHTS.handle;
  if (input.identity_tags.length > 0) score += COMPLETENESS_WEIGHTS.identity;
  if (input.seeking.length > 0) score += COMPLETENESS_WEIGHTS.seeking;
  if (input.bio && input.bio.trim().length > 0) score += COMPLETENESS_WEIGHTS.bio;
  if (input.hasDream) score += COMPLETENESS_WEIGHTS.dream;
  return Math.round((score + Number.EPSILON) * 100) / 100;
}
