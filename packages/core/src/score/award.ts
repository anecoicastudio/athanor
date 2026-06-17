import { reciprocalFactor } from './dampen';
import { reviewerWeight } from './weighting';
import {
  ENGINE_WEIGHTS,
  REACTION_AUTHOR_MIN_SCORE,
  REPORT_PENALTY,
  type ScoringType,
} from './weights';

export interface AwardContext {
  /** Engine-computed from the ledger window; default true (uncapped or within cap). */
  withinCap?: boolean;
  /** 1-indexed exchange number between the same pair — milestone_help / momento_conversation. */
  pairExchangeIndex?: number;
  /** The reactor's Aura — post_starred only counts if strictly above REACTION_AUTHOR_MIN_SCORE. */
  reviewerScore?: number;
  /** report_upheld severity. */
  severity?: 'low' | 'medium' | 'high';
}

/**
 * Signed Aura points for ONE action = weight × cap × dampen × reviewerWeight.
 * Capped, sub-threshold ✦, and any non-scoring type all yield 0 (rule #1 guard).
 * Pure — the engine supplies cap/exchange/reviewer/severity context.
 */
export function pointsFor(type: ScoringType, ctx: AwardContext = {}): number {
  if (ctx.withinCap === false) return 0;
  switch (type) {
    case 'identity_verified':
      return ENGINE_WEIGHTS.IDENTITY_VERIFIED;
    case 'event_attended':
      return ENGINE_WEIGHTS.EVENT_ATTENDED;
    case 'event_organized':
      return ENGINE_WEIGHTS.EVENT_ORGANIZED;
    case 'own_milestone':
      return ENGINE_WEIGHTS.OWN_MILESTONE;
    case 'milestone_help':
      return Math.round(
        ENGINE_WEIGHTS.MILESTONE_HELP * reciprocalFactor(ctx.pairExchangeIndex ?? 1),
      );
    case 'momento_conversation':
      return Math.round(ENGINE_WEIGHTS.MOMENTO_CONV * reciprocalFactor(ctx.pairExchangeIndex ?? 1));
    case 'post_starred': {
      const s = ctx.reviewerScore ?? 0;
      if (s <= REACTION_AUTHOR_MIN_SCORE) return 0;
      return Math.round(ENGINE_WEIGHTS.POST_REACTION * reviewerWeight(s));
    }
    case 'report_upheld':
      return REPORT_PENALTY[ctx.severity ?? 'low'];
    default:
      return 0; // circle / fund / marketplace / unknown → ZERO (rule #1)
  }
}
