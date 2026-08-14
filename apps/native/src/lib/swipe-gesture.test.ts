import { describe, expect, it } from 'vitest';
import {
  CLAIM_SLOP_PX,
  COMMIT_DISTANCE_PX,
  COMMIT_VELOCITY_PX_PER_MS,
  shouldClaimSwipe,
  swipeCommitDirection,
} from './swipe-gesture';

describe('shouldClaimSwipe', () => {
  it('claims a horizontal drag past the slop, in either direction', () => {
    expect(shouldClaimSwipe(CLAIM_SLOP_PX + 1, 0)).toBe(true);
    expect(shouldClaimSwipe(-(CLAIM_SLOP_PX + 1), 0)).toBe(true);
  });

  it('never claims a vertical drag — the tab ScrollView keeps it (#357)', () => {
    // The old predicate (`|dx| > 6 || |dy| > 6`) grabbed vertical drags too, entering the
    // exact tug-of-war with the enclosing ScrollView that froze cards mid-air.
    expect(shouldClaimSwipe(0, 40)).toBe(false);
    expect(shouldClaimSwipe(0, -40)).toBe(false);
  });

  it('yields a diagonal whose vertical component wins', () => {
    expect(shouldClaimSwipe(10, 30)).toBe(false);
    expect(shouldClaimSwipe(30, 10)).toBe(true);
  });

  it('stays quiet inside the slop so taps still reach the card', () => {
    expect(shouldClaimSwipe(CLAIM_SLOP_PX, 0)).toBe(false);
    expect(shouldClaimSwipe(0, 0)).toBe(false);
  });
});

describe('swipeCommitDirection', () => {
  it('commits past the distance threshold in either direction', () => {
    expect(swipeCommitDirection(COMMIT_DISTANCE_PX + 1, 0)).toBe('right');
    expect(swipeCommitDirection(-(COMMIT_DISTANCE_PX + 1), 0)).toBe('left');
  });

  it('snaps back under threshold with no flick', () => {
    expect(swipeCommitDirection(COMMIT_DISTANCE_PX, 0)).toBe(null);
    expect(swipeCommitDirection(-COMMIT_DISTANCE_PX, 0)).toBe(null);
    expect(swipeCommitDirection(0, 0)).toBe(null);
  });

  it('commits a fast flick short of the distance threshold (#357)', () => {
    // A decisive flick used to read as "didn't work": the card travelled 40px, snapped
    // back, and the user swiped the same person again.
    expect(swipeCommitDirection(40, COMMIT_VELOCITY_PX_PER_MS + 0.1)).toBe('right');
    expect(swipeCommitDirection(-40, -(COMMIT_VELOCITY_PX_PER_MS + 0.1))).toBe('left');
  });

  it('a slow drag under both thresholds stays put', () => {
    expect(swipeCommitDirection(40, COMMIT_VELOCITY_PX_PER_MS)).toBe(null);
    expect(swipeCommitDirection(-40, -COMMIT_VELOCITY_PX_PER_MS)).toBe(null);
  });

  it('an opposing flick never commits — displacement and velocity must agree in sign', () => {
    // Dragged right 40px, flung back left: neither a right commit (velocity disagrees)
    // nor a left one (displacement disagrees).
    expect(swipeCommitDirection(40, -2)).toBe(null);
    expect(swipeCommitDirection(-40, 2)).toBe(null);
  });

  it('distance still wins when the release velocity is zero or opposing', () => {
    // Held past the threshold and released dead still — the drag already said yes.
    expect(swipeCommitDirection(COMMIT_DISTANCE_PX + 30, 0)).toBe('right');
    expect(swipeCommitDirection(-(COMMIT_DISTANCE_PX + 30), 0)).toBe('left');
  });
});
