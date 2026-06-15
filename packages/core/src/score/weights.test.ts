import { describe, expect, it, test } from 'vitest';
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

  it('STORY_REACT is the display-only celebration hint (4)', () => {
    expect(AURA_WEIGHTS.STORY_REACT).toBe(4);
  });

  test('publishing a project is worth +4 Aura (compose-hint source, M6 award)', () => {
    expect(AURA_WEIGHTS.PROJECT_CREATE).toBe(4);
  });
});
