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
  /**
   * How long a poster extraction may run before the caller gives up on it (#412).
   *
   * `extractVideoPoster` has no timeout of its own — neither `replaceAsync` nor
   * `generateThumbnailsAsync` is bounded — and an HEVC clip the decoder must seek, or an
   * iCloud-backed `PHAsset`, can take a very long time or never settle. That matters because
   * the candidacy upload awaits the poster BEFORE it reports success: the video is already in
   * Storage, so an unbounded wait trades a finished upload for a tile that spins forever.
   * A poster is best-effort by design (it degrades to a null `thumb_path`), so bounding it
   * costs a thumbnail and saves the submission.
   */
  VIDEO_POSTER_TIMEOUT_MS: 15_000,
  /**
   * Long edge of a processed avatar (#76). The largest an avatar is ever drawn is the 104pt
   * profile hero, so even a 3× screen asks for ~312px; 512 leaves headroom without paying for
   * a camera original that every list row would then downscale on the fly. The bucket's own
   * 5 MiB ceiling is the backstop, not the target.
   */
  AVATAR_MAX_EDGE: 512,
  /** JPEG quality for the avatar encode (0–1). A face at 512px, not a photograph to zoom into. */
  AVATAR_QUALITY: 0.8,
  /** Hard cap on a personal/post video length. */
  MAX_VIDEO_SECONDS: 60,
  /**
   * Hard cap on the bytes of a picked video, checked BEFORE the upload starts (#412).
   *
   * 100 MiB is not a taste: it is exactly `MAX_BYTES` in `supabase/functions/media-process`,
   * which skips any object above it because the edge isolate would OOM holding ~2× the file.
   * A larger video therefore uploads for minutes over a phone connection and then silently
   * misses the server-side strip — so the number the client accepts is the number the
   * backstop can still process, and the member is told «troppo pesante» in one second
   * instead of finding out never.
   */
  MAX_VIDEO_BYTES: 100 * 1024 * 1024,
  /**
   * The video container types an upload may declare. Mirrors the `candidacy-videos` bucket's
   * `allowed_mime_types` and the pgTAP assertion in `0043_candidacy_videos_storage.test.sql`.
   *
   * QuickTime is here because an iPhone camera records `.mov`, and Expo Go cannot transcode
   * (a native module would break App Store Expo Go, which is the only way this app reaches
   * testers — mobile.md). The alternative to accepting it was mislabelling it `video/mp4`,
   * which is what `use-candidacy-upload` used to do: the header passed the bucket check while
   * QuickTime bytes landed under an mp4 label in `storage.objects.metadata`.
   */
  VIDEO_MIME_TYPES: ['video/mp4', 'video/quicktime'],
  /** Max media items attached to one post (multi-image). */
  MAX_POST_MEDIA: 10,
  /** Caption character cap (matches moments.caption CHECK). */
  MAX_CAPTION: 280,
} as const;

export type MediaLimitKey = keyof typeof MEDIA_LIMITS;
