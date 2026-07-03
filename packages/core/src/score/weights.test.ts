import { describe, expect, test } from 'vitest';
// P2.5 hint-truth: the legacy AURA_WEIGHTS display table is gone — ENGINE_WEIGHTS is
// the single source (rule #10). Creating content is deliberately unrewarded; no
// POST_CREATE/COMMENT_CREATE/PROJECT_CREATE keys may reappear.
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
  test('creating content is never rewarded (P2.5 hint-truth, anti-gaming)', () => {
    expect('POST_CREATE' in ENGINE_WEIGHTS).toBe(false);
    expect('COMMENT_CREATE' in ENGINE_WEIGHTS).toBe(false);
    expect('PROJECT_CREATE' in ENGINE_WEIGHTS).toBe(false);
    expect('STORY_REACT' in ENGINE_WEIGHTS).toBe(false);
  });
  test('caps, decay, reviewer floor', () => {
    expect(AURA_CAPS.event_attended).toEqual({ limit: 4, window: 'week' });
    expect(AURA_CAPS.post_starred).toEqual({ limit: 10, window: 'day' });
    expect(AURA_CAPS.identity_verified.window).toBe('lifetime');
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
