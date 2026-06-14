import { describe, expect, test } from 'vitest';
import { AURA_WEIGHTS } from './weights';

describe('AURA_WEIGHTS', () => {
  test('a created post is worth +6 Aura (compose-hint source, M6 award)', () => {
    expect(AURA_WEIGHTS.POST_CREATE).toBe(6);
  });

  test('Circle membership yields zero Aura (rule #1)', () => {
    expect(AURA_WEIGHTS.CIRCLE_JOIN).toBe(0);
  });

  test('fund contributions yield zero Aura (rule #1)', () => {
    expect(AURA_WEIGHTS.FUND_CONTRIBUTION).toBe(0);
  });

  test('a posted comment is worth +2 Aura (compose-hint source, M6 award)', () => {
    expect(AURA_WEIGHTS.COMMENT_CREATE).toBe(2);
  });
});
