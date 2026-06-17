import { expect, test } from 'vitest';
import { pointsFor } from './award';

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
  expect(pointsFor('post_starred', { reviewerScore: 1000 })).toBe(3); // round(2 × 1.6931)
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
