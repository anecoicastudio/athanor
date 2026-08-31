/**
 * The fullscreen photo viewer's gesture, as pure decisions (#576). Extracted rather than
 * inlined — the SwipeDeck precedent (`swipe-gesture.ts`, #357) — so the one property that
 * cannot be seen by reading a `PanResponder` config is assertable: an UPWARD flick must not
 * dismiss. Nothing here is shaped around pinch-zoom, which the 2026-08-30 ruling defers.
 */

/** Past this in either axis the touch is a drag, and the viewer claims it from the surface. */
export const DRAG_CLAIM_PX = 8;

/** A downward release past this dismisses the viewer. */
export const DISMISS_DISTANCE_PX = 100;

/** Under this in BOTH axes, the release was a tap that wobbled rather than a drag. */
export const TAP_SLOP_PX = 10;

/**
 * Whether a moving touch belongs to the viewer. Both axes, unlike the deck's horizontal-only
 * claim: there is nothing to scroll underneath here, so a drag in any direction is the
 * viewer's to interpret.
 */
export function shouldClaimViewerDrag(dx: number, dy: number): boolean {
  return Math.abs(dy) > DRAG_CLAIM_PX || Math.abs(dx) > DRAG_CLAIM_PX;
}

/**
 * Whether a release dismisses: a downward swipe, or a tap.
 *
 * Downward only, the StoriesViewer idiom (#298). An upward flick is how a thumb scrolls, so
 * dismissing on it would fire on a gesture nobody aimed at this viewer — and a photo is
 * exactly what someone flicks past on the way somewhere else.
 */
export function dismissesOnRelease(dx: number, dy: number): boolean {
  if (dy > DISMISS_DISTANCE_PX) return true;
  return Math.abs(dx) < TAP_SLOP_PX && Math.abs(dy) < TAP_SLOP_PX;
}
