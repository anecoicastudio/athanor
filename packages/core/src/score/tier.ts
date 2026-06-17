import { TIER_THRESHOLDS, type TierId } from './weights';

/** The highest tier band whose `min ≤ score` (display-only; never a write). */
export function tierOf(score: number): TierId {
  let current: TierId = TIER_THRESHOLDS[0].tier;
  for (const band of TIER_THRESHOLDS) {
    if (score >= band.min) current = band.tier;
  }
  return current;
}
