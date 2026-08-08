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
  expect(pointsFor('post_starred', { reviewerScore: 301 })).toBeGreaterThan(0);
  expect(pointsFor('post_starred', { reviewerScore: 1000 })).toBe(3); // round(2 × 1.6931)
});
// PRD §4.9 gives +2 as the BASE for a ✦; reviewer weighting is applied on top, so an award
// may exceed it but must never fall below it. The curve's shape is not mandated — only that
// it is monotone in the reactor's score and bounded by the cap.
test('reviewer weighting never pays less than the published base', () => {
  const band = Array.from({ length: 700 }, (_, i) => 301 + i);
  const awards = band.map((s) => pointsFor('post_starred', { reviewerScore: s }));
  expect(Math.min(...awards)).toBeGreaterThanOrEqual(ENGINE_WEIGHTS.POST_REACTION);
  expect(Math.max(...awards)).toBeLessThanOrEqual(
    ENGINE_WEIGHTS.POST_REACTION * REVIEWER_WEIGHT_CAP,
  );
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
