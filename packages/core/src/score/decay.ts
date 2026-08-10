import { clampScore } from './clamp.ts';
import { DECAY } from './weights.ts';

/**
 * Decay (PRD §4.9): score ×0.98 per idle week, floored at 40% of lifetime peak,
 * never below. Returns a clamped integer. Pure — the engine supplies idleWeeks.
 *
 * The 40% floor bounds how far decay may pull a score down; it is not a floor on the
 * score itself. A score already under it — after an upheld report (PRD §4.9) — stays
 * where it is, because nothing outside the earning table may raise a score.
 */
export function applyDecay({
  score,
  peak,
  idleWeeks,
}: {
  score: number;
  peak: number;
  idleWeeks: number;
}): number {
  const decayed = score * Math.pow(DECAY.WEEKLY_FACTOR, Math.max(0, idleWeeks));
  const floor = peak * DECAY.PEAK_FLOOR_RATIO;
  return clampScore(Math.round(Math.min(score, Math.max(floor, decayed))));
}
