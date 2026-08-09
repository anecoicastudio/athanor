import { expect, test } from 'vitest';
import { pointsFor } from './award';
import { ENGINE_WEIGHTS, REVIEWER_WEIGHT_CAP } from './weights';

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
  expect(pointsFor('post_starred', { reviewerScore: 5000 })).toBe(4); // reviewer weight capped at 2
});
// POST_REACTION is a BASE, not an award (weights.ts). The gate and the multiplier interact:
// the lowest reactor who can award anything (301) already weighs ≈1.263, so 2 × 1.263 rounds
// to 3 and the published base is UNREACHABLE — no member can ever observe a ✦ worth 2.
// weights.ts and the PRD §4.9 table both used to claim otherwise; this test is what makes the
// claim checkable rather than prose, so a future edit to the gate, the base or the curve fails
// here instead of silently invalidating a comment.
//
// The band is asserted as a SET, and 5000 is a sufficient upper bound because the reviewer
// curve saturates at ×2 from 1719 — every score above that awards exactly 4, so sampling
// further adds nothing. Integers only, deliberately: `v_reactor_score` is `int` in the trigger.
//
// The 3→4 flip is NOT pinned. It sits at 1118 because the real threshold is
// 1000·(e^0.75 − 1) = 1117.00002 — sixteen millionths of a point above the integer 1117.
// That is deterministic, not a float wobble, but a boundary that knife-edge is an artifact of
// where the curve happens to cross a rounding line, not a rule anyone chose. Asserting it
// would pin the implementation.
test('every qualifying reactor awards 3 or 4 — the published base of 2 is unreachable', () => {
  const band = Array.from({ length: 4700 }, (_, i) => 301 + i); // 301 … 5000
  const awards = new Set(band.map((s) => pointsFor('post_starred', { reviewerScore: s })));
  expect([...awards].sort((a, b) => a - b)).toEqual([3, 4]);
  expect(awards.has(ENGINE_WEIGHTS.POST_REACTION)).toBe(false);
  expect(Math.max(...awards)).toBe(ENGINE_WEIGHTS.POST_REACTION * REVIEWER_WEIGHT_CAP);
});
// The production path, and the reason the band above is currently unobservable (issue #27).
// `athanor.aura_award_post_starred` gates on the reactor's score in SQL and then never sends
// it: the pg_net payload carries only `severity`, so the engine calls this function with
// `reviewerScore` undefined and the `?? 0` default fails the gate a second time. Every ✦
// therefore awards 0 and writes no ledger row. This assert is the tripwire — when the value is
// plumbed, `logic.test.ts` must cover the supplied case, and THIS test must keep passing,
// because an undefined reviewer is still not a qualifying one.
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
