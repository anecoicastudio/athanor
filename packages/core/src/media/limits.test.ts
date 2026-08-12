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

  it('takes the poster frame inside every clip the app accepts', () => {
    expect(MEDIA_LIMITS.VIDEO_POSTER_SECONDS).toBeGreaterThan(0);
    expect(MEDIA_LIMITS.VIDEO_POSTER_SECONDS).toBeLessThan(MEDIA_LIMITS.MAX_VIDEO_SECONDS);
  });
});
