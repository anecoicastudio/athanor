import { AURA_CAPS } from './weights.ts';

/**
 * Whether one more action of `type` is within its cap, given the prior count of
 * that type already in its window (counted from `aura_events` by the engine).
 * Types absent from `AURA_CAPS` are uncapped → always awardable.
 */
export function applyCap(type: string, priorCountInWindow: number): boolean {
  const cap = (AURA_CAPS as Record<string, { limit: number }>)[type];
  if (!cap) return true;
  return priorCountInWindow < cap.limit;
}
