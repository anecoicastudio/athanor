/**
 * High-Aura reviewers weigh more (PRD §4.9): weight = 1 + ln1p(score/1000),
 * monotone in the reviewer's score, capped at 2×. v1 shape — tunable (G-D).
 */
export function reviewerWeight(reviewerScore: number): number {
  if (reviewerScore <= 0) return 1;
  return Math.min(2, 1 + Math.log1p(reviewerScore / 1000));
}
