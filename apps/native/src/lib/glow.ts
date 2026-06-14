import { semantic } from '@athanor/config';

/**
 * RN shadow for moment-grade cyan surfaces (rule #4 — glow = moments only).
 * `level` comes from @athanor/core auraGlowLevel(score); 0 → no glow. Uses the
 * `aura` token (not a literal hex). Foundation §3 recipe: 0 0 24px aura@.45.
 */
export function auraGlow(level: number) {
  if (level <= 0) return {};
  return {
    shadowColor: semantic.aura,
    shadowOpacity: 0.45 * level,
    shadowRadius: 24 * level,
    shadowOffset: { width: 0, height: 0 },
    elevation: Math.round(12 * level),
  } as const;
}
