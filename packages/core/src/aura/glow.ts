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
  if (!Number.isFinite(score) || score <= 0) return 0;
  let level = 0;
  for (const tier of AURA_GLOW_TIERS) {
    if (score >= tier.min) level = tier.level;
  }
  return level;
}
