import { describe, expect, it } from 'vitest';
import {
  DISMISS_DISTANCE_PX,
  DRAG_CLAIM_PX,
  TAP_SLOP_PX,
  dismissesOnRelease,
  shouldClaimViewerDrag,
} from './viewer-gesture';

describe('shouldClaimViewerDrag', () => {
  it('ignores a touch that has barely moved', () => {
    expect(shouldClaimViewerDrag(0, 0)).toBe(false);
    expect(shouldClaimViewerDrag(DRAG_CLAIM_PX, DRAG_CLAIM_PX)).toBe(false);
  });

  it('claims a drag in either axis, either direction', () => {
    expect(shouldClaimViewerDrag(0, DRAG_CLAIM_PX + 1)).toBe(true);
    expect(shouldClaimViewerDrag(0, -(DRAG_CLAIM_PX + 1))).toBe(true);
    expect(shouldClaimViewerDrag(DRAG_CLAIM_PX + 1, 0)).toBe(true);
    expect(shouldClaimViewerDrag(-(DRAG_CLAIM_PX + 1), 0)).toBe(true);
  });
});

describe('dismissesOnRelease', () => {
  it('dismisses on a downward swipe', () => {
    expect(dismissesOnRelease(0, DISMISS_DISTANCE_PX + 1)).toBe(true);
  });

  it('does NOT dismiss on an upward flick, however long', () => {
    // The property the PanResponder config cannot show on inspection: an upward flick is a
    // scroll gesture aimed past this viewer, not at it.
    expect(dismissesOnRelease(0, -(DISMISS_DISTANCE_PX + 1))).toBe(false);
    expect(dismissesOnRelease(0, -500)).toBe(false);
  });

  it('does not dismiss on a downward drag that stops short', () => {
    expect(dismissesOnRelease(0, DISMISS_DISTANCE_PX)).toBe(false);
  });

  it('dismisses on a tap, including one that wobbled', () => {
    expect(dismissesOnRelease(0, 0)).toBe(true);
    expect(dismissesOnRelease(TAP_SLOP_PX - 1, -(TAP_SLOP_PX - 1))).toBe(true);
  });

  it('does not dismiss on a horizontal drag', () => {
    // No horizontal meaning here — a single photo has no neighbours to page to.
    expect(dismissesOnRelease(200, 0)).toBe(false);
    expect(dismissesOnRelease(-200, 0)).toBe(false);
  });
});
