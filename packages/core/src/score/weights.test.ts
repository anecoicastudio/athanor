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

  test('attending an event is worth +15 Aura (read-only detail label, M6 award)', () => {
    expect(AURA_WEIGHTS.EVENT_ATTEND).toBe(15);
  });

  test('organizing an event is worth +30 Aura (read-only label, M6 award)', () => {
    expect(AURA_WEIGHTS.EVENT_ORGANIZE).toBe(30);
  });

  test('MOMENTO_CONV is +5 (the ≥10-message conversation award, M6-awarded)', () => {
    expect(AURA_WEIGHTS.MOMENTO_CONV).toBe(5);
  });
});

import {
  ENGINE_WEIGHTS,
  AURA_CAPS,
  DECAY,
  REPORT_PENALTY,
  TIER_THRESHOLDS,
  STAR_CRITERIA,
  REACTION_AUTHOR_MIN_SCORE,
} from './weights';

describe('ENGINE_WEIGHTS — canonical PRD §4.9', () => {
  test('exact v1 values', () => {
    expect(ENGINE_WEIGHTS.IDENTITY_VERIFIED).toBe(50);
    expect(ENGINE_WEIGHTS.EVENT_ATTENDED).toBe(15);
    expect(ENGINE_WEIGHTS.EVENT_ORGANIZED).toBe(30);
    expect(ENGINE_WEIGHTS.MOMENTO_CONV).toBe(5);
    expect(ENGINE_WEIGHTS.MILESTONE_HELP).toBe(40);
    expect(ENGINE_WEIGHTS.OWN_MILESTONE).toBe(10);
    expect(ENGINE_WEIGHTS.POST_REACTION).toBe(2);
    expect(ENGINE_WEIGHTS.REPORT_UPHELD_MIN).toBe(-50);
    expect(ENGINE_WEIGHTS.REPORT_UPHELD_MAX).toBe(-200);
  });
  test('Circle / fund / marketplace yield ZERO Aura (rule #1)', () => {
    expect(ENGINE_WEIGHTS.CIRCLE_MEMBERSHIP).toBe(0);
    expect(ENGINE_WEIGHTS.FUND_CONTRIBUTION).toBe(0);
    expect(ENGINE_WEIGHTS.MARKETPLACE).toBe(0);
  });
  test('caps, decay, reviewer floor', () => {
    expect(AURA_CAPS.EVENT_ATTENDED).toEqual({ limit: 4, window: 'week' });
    expect(AURA_CAPS.POST_REACTION).toEqual({ limit: 10, window: 'day' });
    expect(AURA_CAPS.IDENTITY_VERIFIED.window).toBe('lifetime');
    expect(DECAY).toEqual({ IDLE_DAYS_BEFORE: 30, WEEKLY_FACTOR: 0.98, PEAK_FLOOR_RATIO: 0.4 });
    expect(REPORT_PENALTY).toEqual({ low: -50, medium: -100, high: -200 });
    expect(REACTION_AUTHOR_MIN_SCORE).toBe(300);
  });
  test('tier bands ascending', () => {
    expect(TIER_THRESHOLDS.map((t) => t.min)).toEqual([0, 250, 500, 750, 1000]);
  });
  test('star criteria (PRD §4.10)', () => {
    expect(STAR_CRITERIA.creatore.ownMilestonesCompleted).toBe(2);
    expect(STAR_CRITERIA.mentor.helpsCompleted).toBe(3);
    expect(STAR_CRITERIA.collaboratore.momentoConversations).toBe(5);
    expect(STAR_CRITERIA.ambasciatore.invitesActivated).toBe(5);
    expect(STAR_CRITERIA.visionario).toEqual({
      dreamPublished: true,
      milestonesDefined: 3,
      ownPostsStarred: 10,
    });
    expect(STAR_CRITERIA.innovatore).toEqual({ evoluzionePostsStarred: 5, distinctStarrers: 10 });
  });
});
