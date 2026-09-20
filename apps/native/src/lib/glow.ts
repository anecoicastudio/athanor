import { semantic } from '@athanor/config';

/** `#2BD0D2` → `43,208,210`. The token owns the colour; the shadow only needs its channels. */
function channels(hex: string) {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(',');
}

/** Trim binary-float tails (24 * 0.3 = 7.199999999999999) before they reach a style string. */
function round(value: number, places: number) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/**
 * RN shadow for moment-grade cyan surfaces (rule #4 — glow = moments only).
 * `level` comes from @athanor/core auraGlowLevel(score); 0 → no glow. Uses the
 * `aura` token (not a literal hex). Foundation §3 recipe: 0 0 24px aura@.45 —
 * which is now emitted literally, instead of being paraphrased per platform.
 *
 * A CSS `boxShadow`, NOT the `shadow*` + `elevation` pair this used to return.
 * Android draws an `elevation` shadow *beneath* the view, from an outline that
 * has dropped the border radius — and every surface a glow lands on is
 * translucent (`aura-soft` is cyan at 10%), so that shadow showed through as a
 * hard square rectangle inside the box (moto g17, 2026-09-20). An outer CSS
 * box-shadow is clipped out of the border box, so nothing can bleed through,
 * and it follows the rounded corners. Cross-platform under the new
 * architecture — RN types `boxShadow` with no `@platform` tag.
 */
export function auraGlow(level: number) {
  // Finite AND positive, not `level > 0`: NaN fails every comparison and Infinity passes it,
  // so either would reach `0 0 NaNpx` / `0 0 Infinitypx` — strings RN's length parser rejects,
  // dropping the whole shadow with no error. Unreachable today, since `auraGlowLevel()` clamps
  // both to 0; a glow that vanishes silently is still the failure worth closing by hand.
  if (!Number.isFinite(level) || level <= 0) return {};
  return {
    boxShadow: `0 0 ${round(24 * level, 2)}px rgba(${channels(semantic.aura)},${round(0.45 * level, 3)})`,
  } as const;
}
