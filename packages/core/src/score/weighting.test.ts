import { expect, test } from 'vitest';
import { reviewerWeight } from './weighting.ts';
import { REVIEWER_WEIGHT_CAP, REVIEWER_WEIGHT_SCALE } from './weights.ts';

test('zero / low score reviewer weighs 1', () => {
  expect(reviewerWeight(0)).toBe(1);
  expect(reviewerWeight(-5)).toBe(1);
});
test('higher score weighs more, monotone', () => {
  expect(reviewerWeight(1000)).toBeCloseTo(1.6931, 3); // 1 + ln(2)
  expect(reviewerWeight(500)).toBeGreaterThan(reviewerWeight(100));
});
test('capped at ~2×', () => {
  expect(reviewerWeight(1_000_000)).toBe(2);
});

test('reviewerWeight is driven by the named G-D constants', () => {
  expect(reviewerWeight(REVIEWER_WEIGHT_SCALE)).toBeCloseTo(1 + Math.log1p(1), 10); // score = SCALE
  expect(reviewerWeight(1_000_000)).toBe(REVIEWER_WEIGHT_CAP);
  expect(REVIEWER_WEIGHT_SCALE).toBe(1000);
  expect(REVIEWER_WEIGHT_CAP).toBe(2);
});
