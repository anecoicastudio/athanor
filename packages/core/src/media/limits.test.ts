import { describe, expect, it } from 'vitest';
import { MEDIA_LIMITS } from './limits';

describe('MEDIA_LIMITS', () => {
  it('caps video at 60s and post media count', () => {
    expect(MEDIA_LIMITS.MAX_VIDEO_SECONDS).toBe(60);
    expect(MEDIA_LIMITS.MAX_POST_MEDIA).toBeGreaterThan(0);
    expect(MEDIA_LIMITS.IMAGE_MAX_LONG_EDGE).toBe(2048);
  });

  it('sizes a video poster below a full image — it only ever fills a grid tile', () => {
    expect(MEDIA_LIMITS.VIDEO_POSTER_MAX_EDGE).toBeLessThan(MEDIA_LIMITS.IMAGE_MAX_LONG_EDGE);
    expect(MEDIA_LIMITS.VIDEO_POSTER_QUALITY).toBeGreaterThan(0);
    expect(MEDIA_LIMITS.VIDEO_POSTER_QUALITY).toBeLessThanOrEqual(1);
  });

  it('sizes an avatar below a poster — it never renders larger than the profile hero (#76)', () => {
    // The `avatars` bucket caps objects at 5 MiB (20260811072211); the point of the edge cap is
    // that a 12 MP camera original is never stored and then downscaled on every single row.
    expect(MEDIA_LIMITS.AVATAR_MAX_EDGE).toBeLessThan(MEDIA_LIMITS.VIDEO_POSTER_MAX_EDGE);
    expect(MEDIA_LIMITS.AVATAR_QUALITY).toBeGreaterThan(0);
    expect(MEDIA_LIMITS.AVATAR_QUALITY).toBeLessThanOrEqual(1);
  });

  it('takes the poster frame inside every clip the app accepts', () => {
    expect(MEDIA_LIMITS.VIDEO_POSTER_SECONDS).toBeGreaterThan(0);
    expect(MEDIA_LIMITS.VIDEO_POSTER_SECONDS).toBeLessThan(MEDIA_LIMITS.MAX_VIDEO_SECONDS);
  });
});
