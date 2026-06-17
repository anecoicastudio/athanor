import { expect, test } from 'vitest';
import { reviewerWeight } from './weighting';

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
