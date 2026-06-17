import { expect, test } from 'vitest';
import { reciprocalFactor } from './dampen';

test('first exchange is full weight', () => {
  expect(reciprocalFactor(1)).toBe(1);
  expect(reciprocalFactor(0)).toBe(1); // guard
});
test('reciprocal exchanges dampen (PRD §4.9 pairwise diminishing returns)', () => {
  expect(reciprocalFactor(2)).toBeCloseTo(0.6667, 4);
  expect(reciprocalFactor(3)).toBeCloseTo(0.5, 4);
});
test('factor stays in (0,1]', () => {
  const f = reciprocalFactor(100);
  expect(f).toBeGreaterThan(0);
  expect(f).toBeLessThanOrEqual(1);
});
