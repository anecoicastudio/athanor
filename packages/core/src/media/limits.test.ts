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

  it('caps a video at the size the server-side strip can still process (#412)', () => {
    // 100 MiB exactly — media-process/index.ts skips anything larger, so a file above this
    // uploads slowly and then silently misses the strip. Accepting only what the backstop
    // can process is what makes the cap worth having.
    expect(MEDIA_LIMITS.MAX_VIDEO_BYTES).toBe(104_857_600);
    expect(MEDIA_LIMITS.MAX_VIDEO_BYTES).toBe(100 * 1024 * 1024);
  });

  it('bounds the poster extraction so a hung decoder cannot hold the tile (#412)', () => {
    // The video is already in Storage by the time the poster runs, so waiting forever for a
    // frame trades a finished upload for a spinner that never stops. Long enough that a normal
    // clip finishes, short enough that a member notices nothing.
    expect(MEDIA_LIMITS.VIDEO_POSTER_TIMEOUT_MS).toBe(15_000);
    expect(MEDIA_LIMITS.VIDEO_POSTER_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('accepts mp4 and quicktime — an iPhone records .mov (#412)', () => {
    // Mirrors the candidacy-videos bucket's allowed_mime_types (20260817… widening) and the
    // assertion in supabase/tests/0043_candidacy_videos_storage.test.sql. Rejecting quicktime
    // would reject the primary capture path on iOS, and Expo Go cannot transcode.
    expect(MEDIA_LIMITS.VIDEO_MIME_TYPES).toEqual(['video/mp4', 'video/quicktime']);
    expect(MEDIA_LIMITS.VIDEO_MIME_TYPES).toContain('video/mp4');
    expect(MEDIA_LIMITS.VIDEO_MIME_TYPES).toContain('video/quicktime');
  });
});
