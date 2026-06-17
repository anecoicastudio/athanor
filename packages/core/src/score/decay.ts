import { clampScore } from './clamp';
import { DECAY } from './weights';

/**
 * Decay (PRD §4.9): score ×0.98 per idle week, floored at 40% of lifetime peak,
 * never below. Returns a clamped integer. Pure — the engine supplies idleWeeks.
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
  return clampScore(Math.round(Math.max(floor, decayed)));
}
