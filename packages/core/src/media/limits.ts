/**
 * MEDIA_LIMITS — the single source of upload/processing bounds (rule #10).
 * Server-tunable later; never scatter these numbers. Mirrors resilience §7.
 */
export const MEDIA_LIMITS = {
  /** Re-encode images down to this long edge (EXIF strip + size) — resilience §7.1/§7.2. */
  IMAGE_MAX_LONG_EDGE: 2048,
  /** JPEG quality for the re-encode pass (0–1). */
  IMAGE_QUALITY: 0.8,
  /** Hard cap on a personal/post video length. */
  MAX_VIDEO_SECONDS: 60,
  /** Max media items attached to one post (multi-image). */
  MAX_POST_MEDIA: 10,
  /** Caption character cap (matches moments.caption CHECK). */
  MAX_CAPTION: 280,
} as const;

export type MediaLimitKey = keyof typeof MEDIA_LIMITS;
