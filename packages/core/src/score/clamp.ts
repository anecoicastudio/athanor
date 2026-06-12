export const SCORE_MIN = 0;
export const SCORE_MAX = 1000;

/** Kaira Score display range is 0–1000, integers only. */
export function clampScore(value: number): number {
  if (Number.isNaN(value)) return SCORE_MIN;
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.round(value)));
}
