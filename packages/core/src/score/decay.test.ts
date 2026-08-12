import { expect, test } from 'vitest';
import { applyDecay } from './decay.ts';

test('no idle weeks → unchanged', () => {
  expect(applyDecay({ score: 800, peak: 900, idleWeeks: 0 })).toBe(800);
});
test('one idle week → ×0.98 rounded', () => {
  expect(applyDecay({ score: 1000, peak: 1000, idleWeeks: 1 })).toBe(980);
});
test('floors at 40% of peak, never below (PRD §4.9)', () => {
  expect(applyDecay({ score: 1000, peak: 1000, idleWeeks: 1000 })).toBe(400);
  expect(applyDecay({ score: 500, peak: 1000, idleWeeks: 1000 })).toBe(400);
});
// PRD §4.9 makes 40% of lifetime peak a floor on decay, and the earning table the only
// source of gains. A score already below that floor — after an upheld report — must not
// be lifted up to it by the nightly run.
test('never increases a score', () => {
  expect(applyDecay({ score: 300, peak: 1000, idleWeeks: 1 })).toBeLessThanOrEqual(300);
});
test('result is a clamped integer', () => {
  const r = applyDecay({ score: 777, peak: 800, idleWeeks: 3 });
  expect(Number.isInteger(r)).toBe(true);
  expect(r).toBeLessThanOrEqual(1000);
  expect(r).toBeGreaterThanOrEqual(0);
});
