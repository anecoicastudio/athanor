import { describe, expect, it } from 'vitest';
import { MEDIA_LIMITS } from './limits';
import { videoPosterTime } from './poster';

describe('videoPosterTime', () => {
  it('offsets into a normal-length clip rather than taking frame zero', () => {
    // Frame zero is where a fade-in lives, so a poster taken there is often black.
    expect(videoPosterTime(30)).toBe(MEDIA_LIMITS.VIDEO_POSTER_SECONDS);
    expect(videoPosterTime(MEDIA_LIMITS.MAX_VIDEO_SECONDS)).toBe(MEDIA_LIMITS.VIDEO_POSTER_SECONDS);
  });

  it('never asks past the midpoint of a clip shorter than twice the offset', () => {
    // Requesting a time beyond the asset yields whatever the decoder clamps to — or nothing.
    expect(videoPosterTime(0.4)).toBe(0.2);
    expect(videoPosterTime(MEDIA_LIMITS.VIDEO_POSTER_SECONDS)).toBe(
      MEDIA_LIMITS.VIDEO_POSTER_SECONDS / 2,
    );
  });

  it('falls back to frame zero when the duration is unknown or degenerate', () => {
    // The picker does not always report a duration; without one there is nothing to clamp
    // against, and frame zero is the only time guaranteed to exist.
    expect(videoPosterTime(null)).toBe(0);
    expect(videoPosterTime(undefined)).toBe(0);
    expect(videoPosterTime(0)).toBe(0);
    expect(videoPosterTime(-5)).toBe(0);
    expect(videoPosterTime(Number.NaN)).toBe(0);
  });
});
