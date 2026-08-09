/**
 * Maps a read-only Aura score to a mandorla glow intensity (0–1). The frame
 * brightens with reputation; M1 score is a read-only seed (0 → no glow). Tier
 * thresholds are named here so they stay server-tunable and test-asserted —
 * never scatter the numbers into components. (Glow ≠ score weights, rule #10.)
 */
export const AURA_GLOW_TIERS = [
  { min: 1, level: 0.4 },
  { min: 250, level: 0.6 },
  { min: 500, level: 0.8 },
  { min: 1000, level: 1 },
] as const;

export function auraGlowLevel(score: number): number {
  // The `!Number.isFinite` half is load-bearing: +Infinity clears every tier `min`, so without
  // it the loop would light the top tier. The `score <= 0` half is not — the lowest tier starts
  // at 1, so any score ≤ 0 already falls out of the loop at level 0. It stays because it states
  // the intent ("no glow below 1") at the top instead of leaving the reader to derive it, and
  // it is why two mutants on that operand survive: each is an equivalent mutant, not untested.
  if (!Number.isFinite(score) || score <= 0) return 0;
  let level = 0;
  for (const tier of AURA_GLOW_TIERS) {
    if (score >= tier.min) level = tier.level;
  }
  return level;
}
