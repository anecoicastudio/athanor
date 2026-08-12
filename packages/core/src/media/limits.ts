/**
 * MEDIA_LIMITS — the single source of upload/processing bounds (rule #10).
 * Server-tunable later; never scatter these numbers. Mirrors resilience §7.
 */
export const MEDIA_LIMITS = {
  /** Re-encode images down to this long edge (EXIF strip + size) — resilience §7.1/§7.2. */
  IMAGE_MAX_LONG_EDGE: 2048,
  /** JPEG quality for the re-encode pass (0–1). */
  IMAGE_QUALITY: 0.8,
  /**
   * Long edge of the poster frame extracted from a video. A third of a phone screen is what
   * this ever fills (the Momenti grid is 3 columns), so IMAGE_MAX_LONG_EDGE would be paying
   * for pixels the tile cannot show — and every video Momento pays it twice, once in bytes
   * and once in the signed-URL fetch.
   */
  VIDEO_POSTER_MAX_EDGE: 1024,
  /** JPEG quality for the poster encode (0–1). Lower than a real photo: it is a thumbnail. */
  VIDEO_POSTER_QUALITY: 0.7,
  /**
   * How far into a clip the poster frame is taken. Not zero: frame zero is where a fade-in,
   * a lens cap or an auto-exposure ramp lives, and a black poster is the bug this replaces.
   */
  VIDEO_POSTER_SECONDS: 0.5,
  /** Hard cap on a personal/post video length. */
  MAX_VIDEO_SECONDS: 60,
  /** Max media items attached to one post (multi-image). */
  MAX_POST_MEDIA: 10,
  /** Caption character cap (matches moments.caption CHECK). */
  MAX_CAPTION: 280,
} as const;

export type MediaLimitKey = keyof typeof MEDIA_LIMITS;
