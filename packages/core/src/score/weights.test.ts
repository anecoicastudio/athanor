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
  CREDITABLE_TYPES,
  BUCKET_MAP,
} from './weights.ts';

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
      evoluzionePostsStarred: 10,
    });
    expect(STAR_CRITERIA.innovatore).toEqual({ evoluzionePostsStarred: 5, distinctStarrers: 10 });
  });
});

test('CREDITABLE_TYPES is exactly the PRD earning table plus engine decay (rule #1)', () => {
  // The read-path backstop for rule #1. Asserted as an exact set, member by member, because
  // a mutation run showed four entries could be blanked to '' with no test failing: drop
  // 'report_upheld' and an upheld −200 penalty silently stops counting toward the score, so a
  // member sheds it by doing nothing. Mirrors the aura_events.type CHECK constraint
  // (20260617104046_aura_events.sql).
  expect([...CREDITABLE_TYPES].sort()).toEqual(
    [
      'decay',
      'event_attended',
      'event_organized',
      'identity_verified',
      'milestone_help',
      'momento_conversation',
      'own_milestone',
      'post_starred',
      'report_upheld',
    ].sort(),
  );
});

test('no paid-for action is creditable (rule #1)', () => {
  // Circle membership and fund contributions yield ZERO points. Naming them explicitly means
  // adding one to the set fails here rather than quietly minting score on the read path.
  for (const paid of ['circle_membership', 'fund_contribution', 'marketplace_purchase']) {
    expect(CREDITABLE_TYPES.has(paid)).toBe(false);
  }
});

test('every bucketed type is creditable, and decay is creditable without a bucket', () => {
  // BUCKET_MAP and CREDITABLE_TYPES must not drift apart: a type that buckets but does not
  // credit would show points in a breakdown that the headline score does not contain.
  for (const type of Object.keys(BUCKET_MAP)) expect(CREDITABLE_TYPES.has(type)).toBe(true);
  expect(CREDITABLE_TYPES.has('decay')).toBe(true);
  expect(Object.keys(BUCKET_MAP)).not.toContain('decay');
});
