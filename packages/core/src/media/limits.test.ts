import { describe, expect, it } from 'vitest';
import { MEDIA_LIMITS } from './limits';

describe('MEDIA_LIMITS', () => {
  it('caps video at 60s and post media count', () => {
    expect(MEDIA_LIMITS.MAX_VIDEO_SECONDS).toBe(60);
    expect(MEDIA_LIMITS.MAX_POST_MEDIA).toBeGreaterThan(0);
    expect(MEDIA_LIMITS.IMAGE_MAX_LONG_EDGE).toBe(2048);
  });
});
