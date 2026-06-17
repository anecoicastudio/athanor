import { RECIPROCAL_DAMPENING } from './weights';

/**
 * Pairwise diminishing returns (PRD §4.9): the n-th reciprocal exchange between
 * the same two profiles is worth factor(n) = 1 / (1 + k·(n−1)) ∈ (0, 1], where
 * k = RECIPROCAL_DAMPENING (G-D, weights.ts). `n < 1` is treated as the first exchange.
 */
export function reciprocalFactor(exchangeIndex: number): number {
  const n = Math.max(1, Math.floor(exchangeIndex));
  return 1 / (1 + RECIPROCAL_DAMPENING * (n - 1));
}
