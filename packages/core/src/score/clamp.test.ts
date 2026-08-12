import { describe, expect, test } from 'vitest';
import { clampScore, SCORE_MAX, SCORE_MIN } from './clamp.ts';

describe('clampScore', () => {
  test('returns value unchanged when within 0..1000', () => {
    expect(clampScore(412)).toBe(412);
  });

  test('clamps negative values to 0', () => {
    expect(clampScore(-50)).toBe(SCORE_MIN);
  });

  test('clamps values above 1000 to 1000', () => {
    expect(clampScore(1500)).toBe(SCORE_MAX);
  });

  test('rounds fractional values to nearest integer', () => {
    expect(clampScore(412.6)).toBe(413);
  });

  test('treats NaN as 0', () => {
    expect(clampScore(Number.NaN)).toBe(SCORE_MIN);
  });
});
