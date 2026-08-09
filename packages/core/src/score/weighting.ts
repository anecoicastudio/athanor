import { REVIEWER_WEIGHT_CAP, REVIEWER_WEIGHT_SCALE } from './weights';

/**
 * High-Aura reviewers weigh more (PRD §4.9): weight = 1 + ln1p(score/SCALE),
 * monotone in the reviewer's score, capped at CAP (G-D, weights.ts). v1 = FINAL.
 */
export function reviewerWeight(reviewerScore: number): number {
  // At exactly 0 the formula already yields 1 (log1p(0) === 0), so `<= 0` vs `< 0` is
  // unobservable — an equivalent mutant. The guard exists for negative scores.
  if (reviewerScore <= 0) return 1;
  return Math.min(REVIEWER_WEIGHT_CAP, 1 + Math.log1p(reviewerScore / REVIEWER_WEIGHT_SCALE));
}
