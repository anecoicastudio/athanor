/**
 * _core.ts — thin re-export shim for score-engine.
 *
 * The `packages/core/src/score/*` files use extension-less imports written for
 * the Node/pnpm TypeScript bundler. Deno requires explicit `.ts` extensions.
 * Rather than importing the core files directly (which would fail at their own
 * transitive imports), we re-export the functions we need from the leaf modules
 * — those that have NO further local imports. The math itself lives entirely in
 * `packages/core` (rule #10 single-source), never duplicated here.
 *
 * Leaf modules (zero local imports):
 *   weights.ts, clamp.ts, dampen.ts, weighting.ts
 *
 * Non-leaf modules whose logic we inline here using ONLY the leaf exports.
 *   award.ts, caps.ts, decay.ts, aggregate.ts, stars.ts, tier.ts
 *
 * Any change to packages/core score logic MUST be reflected here until the
 * engine is refactored to use a compiled package or Deno-native imports.
 */

// ── Leaf re-exports (safe: no local imports) ────────────────────────────────

export {
  ENGINE_WEIGHTS,
  AURA_CAPS,
  AURA_WEIGHTS,
  REACTION_AUTHOR_MIN_SCORE,
  REPORT_PENALTY,
  TIER_THRESHOLDS,
  STAR_CRITERIA,
  BUCKET_MAP,
  DECAY,
} from '../../../packages/core/src/score/weights.ts';
export type {
  ScoringType,
  CapWindow,
  AuraWeightKey,
  TierId,
  BucketKey,
} from '../../../packages/core/src/score/weights.ts';

export { clampScore, SCORE_MIN, SCORE_MAX } from '../../../packages/core/src/score/clamp.ts';
export { reciprocalFactor } from '../../../packages/core/src/score/dampen.ts';
export { reviewerWeight } from '../../../packages/core/src/score/weighting.ts';

// ── StarKey — imported directly from schemas/src/aura.ts (bypasses index.ts) ─

export type { StarKey } from '../../../packages/schemas/src/aura.ts';
export { STAR_KEYS } from '../../../packages/schemas/src/aura.ts';

// ── Re-implemented wrappers (identical logic, Deno-compatible imports) ────────
// These mirror the packages/core implementations exactly. Any logic change in
// core MUST be mirrored here. Marked with source file for easy auditing.

import {
  ENGINE_WEIGHTS,
  AURA_CAPS,
  REACTION_AUTHOR_MIN_SCORE,
  REPORT_PENALTY,
  TIER_THRESHOLDS,
  STAR_CRITERIA,
  BUCKET_MAP,
  DECAY,
  type ScoringType,
  type TierId,
  type BucketKey,
} from '../../../packages/core/src/score/weights.ts';
import { clampScore } from '../../../packages/core/src/score/clamp.ts';
import { reciprocalFactor } from '../../../packages/core/src/score/dampen.ts';
import { reviewerWeight } from '../../../packages/core/src/score/weighting.ts';

// ── AwardContext / pointsFor (mirrors award.ts) ──────────────────────────────

export interface AwardContext {
  withinCap?: boolean;
  pairExchangeIndex?: number;
  reviewerScore?: number;
  severity?: 'low' | 'medium' | 'high';
}

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
      return 0;
  }
}

// ── applyCap (mirrors caps.ts) ───────────────────────────────────────────────

export function applyCap(type: string, priorCountInWindow: number): boolean {
  const cap = (AURA_CAPS as Record<string, { limit: number }>)[type];
  if (!cap) return true;
  return priorCountInWindow < cap.limit;
}

// ── applyDecay (mirrors decay.ts) ───────────────────────────────────────────

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

// ── LedgerLine / aggregateScore (mirrors aggregate.ts) ──────────────────────

const BUCKETS: BucketKey[] = [
  'contributi',
  'eventi',
  'collaborazioni',
  'valore',
  'recensioni',
  'affidabilita',
];

export interface LedgerLine {
  type: string;
  points: number;
}

export function aggregateScore(events: LedgerLine[]): {
  score: number;
  breakdown: Record<BucketKey, number>;
} {
  const breakdown = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<BucketKey, number>;
  let raw = 0;
  for (const e of events) {
    raw += e.points;
    const bucket = (BUCKET_MAP as Record<string, BucketKey>)[e.type] ?? null;
    if (bucket) breakdown[bucket] += e.points;
  }
  for (const b of BUCKETS) breakdown[b] = Math.max(0, breakdown[b]);
  return { score: clampScore(raw), breakdown };
}

// ── StarFacts / StarProgress / evaluateStars (mirrors stars.ts) ──────────────

import type { StarKey } from '../../../packages/schemas/src/aura.ts';

export interface StarFacts {
  dreamPublished: boolean;
  milestonesDefined: number;
  ownMilestonesCompleted: number;
  helpsCompleted: number;
  evoluzionePostsStarred: number;
  distinctStarrers: number;
  momentoConversations: number;
  invitesActivated: number;
}

export interface StarProgress {
  done: number;
  total: number;
  unit: string;
}

const clampDone = (done: number, total: number): number => Math.min(done, total);

export function evaluateStars(facts: StarFacts): {
  granted: StarKey[];
  progress: Record<StarKey, StarProgress>;
} {
  const visionarioMet =
    facts.dreamPublished &&
    facts.milestonesDefined >= STAR_CRITERIA.visionario.milestonesDefined &&
    facts.evoluzionePostsStarred >= STAR_CRITERIA.visionario.ownPostsStarred;
  const innovatoreMet =
    facts.evoluzionePostsStarred >= STAR_CRITERIA.innovatore.evoluzionePostsStarred &&
    facts.distinctStarrers >= STAR_CRITERIA.innovatore.distinctStarrers;

  const progress: Record<StarKey, StarProgress> = {
    visionario: {
      done: clampDone(
        facts.dreamPublished ? facts.evoluzionePostsStarred : 0,
        STAR_CRITERIA.visionario.ownPostsStarred,
      ),
      total: STAR_CRITERIA.visionario.ownPostsStarred,
      unit: 'reazioni',
    },
    creatore: {
      done: clampDone(facts.ownMilestonesCompleted, STAR_CRITERIA.creatore.ownMilestonesCompleted),
      total: STAR_CRITERIA.creatore.ownMilestonesCompleted,
      unit: 'tappe',
    },
    mentor: {
      done: clampDone(facts.helpsCompleted, STAR_CRITERIA.mentor.helpsCompleted),
      total: STAR_CRITERIA.mentor.helpsCompleted,
      unit: 'aiuti',
    },
    innovatore: {
      done: clampDone(facts.distinctStarrers, STAR_CRITERIA.innovatore.distinctStarrers),
      total: STAR_CRITERIA.innovatore.distinctStarrers,
      unit: 'reazioni',
    },
    collaboratore: {
      done: clampDone(facts.momentoConversations, STAR_CRITERIA.collaboratore.momentoConversations),
      total: STAR_CRITERIA.collaboratore.momentoConversations,
      unit: 'momenti',
    },
    ambasciatore: {
      done: clampDone(facts.invitesActivated, STAR_CRITERIA.ambasciatore.invitesActivated),
      total: STAR_CRITERIA.ambasciatore.invitesActivated,
      unit: 'inviti',
    },
  };

  const granted: StarKey[] = [];
  if (visionarioMet) granted.push('visionario');
  if (facts.ownMilestonesCompleted >= STAR_CRITERIA.creatore.ownMilestonesCompleted)
    granted.push('creatore');
  if (facts.helpsCompleted >= STAR_CRITERIA.mentor.helpsCompleted) granted.push('mentor');
  if (innovatoreMet) granted.push('innovatore');
  if (facts.momentoConversations >= STAR_CRITERIA.collaboratore.momentoConversations)
    granted.push('collaboratore');
  if (facts.invitesActivated >= STAR_CRITERIA.ambasciatore.invitesActivated)
    granted.push('ambasciatore');

  return { granted, progress };
}

// ── tierOf (mirrors tier.ts) ─────────────────────────────────────────────────

export function tierOf(score: number): TierId {
  let current: TierId = TIER_THRESHOLDS[0].tier;
  for (const band of TIER_THRESHOLDS) {
    if (score >= band.min) current = band.tier;
  }
  return current;
}
