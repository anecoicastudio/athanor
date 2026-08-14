import { expect, test } from 'vitest';
import { pointsFor } from './award.ts';
import { SCORE_MAX } from './clamp.ts';
import { ENGINE_WEIGHTS, REACTION_AUTHOR_MIN_SCORE, REVIEWER_WEIGHT_CAP } from './weights.ts';

test('flat awards', () => {
  expect(pointsFor('identity_verified')).toBe(50);
  expect(pointsFor('event_attended')).toBe(15);
  expect(pointsFor('event_organized')).toBe(30);
  expect(pointsFor('own_milestone')).toBe(10);
});
test('capped action awards 0', () => {
  expect(pointsFor('event_attended', { withinCap: false })).toBe(0);
});
test('milestone_help dampens on repeated reciprocal exchange', () => {
  expect(pointsFor('milestone_help', { pairExchangeIndex: 1 })).toBe(40);
  expect(pointsFor('milestone_help', { pairExchangeIndex: 3 })).toBe(20); // 40 × 0.5
});
test('momento_conversation base +5 dampened', () => {
  expect(pointsFor('momento_conversation', { pairExchangeIndex: 1 })).toBe(5);
});
test('post_starred only counts from a reactor with score > 300, reviewer-weighted', () => {
  expect(pointsFor('post_starred', { reviewerScore: 300 })).toBe(0); // not strictly above
  expect(pointsFor('post_starred', { reviewerScore: 301 })).toBe(3); // the floor: round(2 × 1.2631)
  expect(pointsFor('post_starred', { reviewerScore: 1000 })).toBe(3); // round(2 × 1.6931)
  // Out-of-domain curve property: real scores clamp at SCORE_MAX (1000), so no reactor can
  // reach the ×2 cap — but the curve itself must still saturate there, not grow unbounded.
  expect(pointsFor('post_starred', { reviewerScore: 5000 })).toBe(
    ENGINE_WEIGHTS.POST_REACTION * REVIEWER_WEIGHT_CAP,
  );
});
// POST_REACTION is a BASE, not an award (weights.ts). The gate and the multiplier interact:
// the lowest reactor who can award anything (301) already weighs ≈1.263, so 2 × 1.263 rounds
// to 3 and the published base is UNREACHABLE — no member can ever observe a ✦ worth 2.
// weights.ts and the PRD §4.9 table both used to claim otherwise; this test is what makes the
// claim checkable rather than prose, so a future edit to the gate, the base or the curve fails
// here instead of silently invalidating a comment.
//
// The sample is the REAL domain, exhaustively: aura_scores.score lives in [0, SCORE_MAX]
// (clamp.ts, mirrored by the aura_scores CHECK constraint), and `v_reactor_score` is `int`
// in the trigger — integers only, deliberately. Within that domain the band is exactly {3}:
// the 4 arm of the curve needs 2·weight to cross 3.5, first true at 1000·(e^0.75 − 1)
// ≈ 1117.00002 — above the clamp, so no real reactor can ever award 4. (The curve's ×2 cap
// beyond the domain is pinned by the 5000 case above.)
test('every qualifying reactor awards exactly 3 — the published base of 2 is unreachable', () => {
  const band = Array.from(
    { length: SCORE_MAX - REACTION_AUTHOR_MIN_SCORE },
    (_, i) => REACTION_AUTHOR_MIN_SCORE + 1 + i,
  ); // 301 … SCORE_MAX
  const awards = new Set(band.map((s) => pointsFor('post_starred', { reviewerScore: s })));
  expect([...awards]).toEqual([3]);
  expect(awards.has(ENGINE_WEIGHTS.POST_REACTION)).toBe(false);
});
// Issue #27 (RESOLVED 2026-08-09, migration 20260809172520): the enqueue payload used to carry
// no reviewerScore at all, the `?? 0` default failed the gate a second time, and every ✦
// awarded 0 with no ledger row. The trigger now sends the reactor's score and `logic.test.ts`
// covers the supplied case. This assert stays as the guard for the absent one — an undefined
// reviewer is still not a qualifying reviewer, and must never fall through to the base.
test('a ✦ with no reactor score awards nothing — it must never fall through to the base', () => {
  expect(pointsFor('post_starred', {})).toBe(0);
  expect(pointsFor('post_starred')).toBe(0);
});
test('reviewer weighting is monotone in the reactor score', () => {
  const awards = [301, 500, 800, 1000].map((s) => pointsFor('post_starred', { reviewerScore: s }));
  expect(awards).toEqual([...awards].sort((a, b) => a - b));
});
test('report_upheld is negative by severity', () => {
  expect(pointsFor('report_upheld', { severity: 'low' })).toBe(-50);
  expect(pointsFor('report_upheld', { severity: 'high' })).toBe(-200);
  expect(pointsFor('report_upheld')).toBe(-50); // default low
});
test('no path produces points for a non-scoring action (rule #1 guard)', () => {
  expect(pointsFor('circle_membership' as never, {})).toBe(0);
  expect(pointsFor('fund_contribution' as never, {})).toBe(0);
});

test('momento_conversation dampens past the first exchange, and is not divided by the factor', () => {
  // A mutation run turned `MOMENTO_CONV * reciprocalFactor(...)` into `/` and every test still
  // passed, because they all used pairExchangeIndex 1 where the factor is 1 and 5*1 === 5/1.
  // Index 3 → factor 0.5 → 5*0.5 = 2.5 → 3, where division would give 10.
  expect(pointsFor('momento_conversation', { pairExchangeIndex: 3 })).toBe(3);
  expect(pointsFor('momento_conversation', { pairExchangeIndex: 5 })).toBe(2);
});

test('milestone_help dampening is a decreasing curve, never a growing one', () => {
  const points = [1, 2, 3, 5, 9].map((n) => pointsFor('milestone_help', { pairExchangeIndex: n }));
  for (let i = 1; i < points.length; i++) expect(points[i]!).toBeLessThan(points[i - 1]!);
  expect(points[0]).toBe(40);
});
