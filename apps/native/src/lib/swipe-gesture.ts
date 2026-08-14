/**
 * The Momenti SwipeDeck gesture, as pure decisions (#357). The deck lives inside the
 * tab's vertical ScrollView, so which drags the deck claims and which releases commit
 * a swipe are the load-bearing calls — extracted here so they are testable and the
 * tuning lives in one place as named constants.
 */

/** A touch must travel this far before the deck considers claiming it at all. */
export const CLAIM_SLOP_PX = 6;

/** A release past this horizontal displacement commits the swipe. */
export const COMMIT_DISTANCE_PX = 90;

/**
 * A release at or above this horizontal velocity commits as a flick even short of
 * COMMIT_DISTANCE_PX. `gestureState.vx` is px/ms, so 0.5 ≈ a decisive 500 px/s flick.
 */
export const COMMIT_VELOCITY_PX_PER_MS = 0.5;

/** Fly-out travel (x, y) and durations — the −40y gives the exit a slight arc. */
export const FLY_OUT_X_PX = 520;
export const FLY_OUT_Y_PX = -40;
export const FLY_OUT_MS = 420;
export const FLY_OUT_REDUCED_MS = 160;

export type SwipeDirection = 'left' | 'right';

/**
 * Claim only horizontal intent: past the slop AND more horizontal than vertical.
 * Anything else stays with the enclosing ScrollView — the old `|dx| > 6 || |dy| > 6`
 * claimed vertical drags too and set up the responder tug-of-war of #357.
 */
export function shouldClaimSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) > CLAIM_SLOP_PX && Math.abs(dx) > Math.abs(dy);
}

/**
 * What a release means: past the distance threshold OR a fast flick whose velocity
 * agrees in sign with the displacement. `null` = spring back.
 */
export function swipeCommitDirection(dx: number, vx: number): SwipeDirection | null {
  if (dx > COMMIT_DISTANCE_PX || (dx > 0 && vx > COMMIT_VELOCITY_PX_PER_MS)) return 'right';
  if (dx < -COMMIT_DISTANCE_PX || (dx < 0 && vx < -COMMIT_VELOCITY_PX_PER_MS)) return 'left';
  return null;
}
