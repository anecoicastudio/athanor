import type { ImagePickerAsset } from 'expo-image-picker';
import { MEDIA_LIMITS } from '@athanor/core';

/**
 * A single picked asset, normalized into the shape the rest of the media
 * pipeline consumes. `duration_s` is seconds (the picker returns ms).
 */
export type PickedMedia = {
  kind: 'image' | 'video';
  uri: string;
  width?: number;
  height?: number;
  duration_s?: number;
  mimeType?: string;
  /** File size in bytes, when the picker reported one. Undefined is «unknown», never zero. */
  bytes?: number;
};

/** Why a picked video cannot be uploaded. Mirrors the same members of `VideoFailure` (#412). */
export type VideoRejection = 'too-long' | 'too-large' | 'unsupported-type';

/**
 * What a candidacy video pick amounted to. A rejection carries its reason so the tile can name
 * it — the old shape was a bare `null`, indistinguishable from the member tapping Cancel.
 */
export type VideoPickOutcome =
  | { outcome: 'picked'; media: PickedMedia; contentType: string }
  | { outcome: 'rejected'; reason: VideoRejection };

/** The picker asset → PickedMedia, with no acceptance rules applied. */
function normalize(asset: ImagePickerAsset): PickedMedia {
  const isVideo = asset.type === 'video';
  const kind: 'image' | 'video' = isVideo ? 'video' : 'image';
  const durationMs = asset.duration ?? null;
  const duration_s = durationMs != null ? Math.round(durationMs / 1000) : undefined;

  return {
    kind,
    uri: asset.uri,
    width: asset.width || undefined,
    height: asset.height || undefined,
    duration_s,
    mimeType: asset.mimeType,
    bytes: asset.fileSize || undefined,
  };
}

/**
 * Map a picker asset → PickedMedia. Returns `null` if a video exceeds the 60s cap.
 * `livePhoto`/`pairedVideo` are coerced to `image` (we never request them, but be defensive),
 * as is a rare Android ContentProvider `null` type.
 *
 * This is the LOSSY door — it cannot say why it returned null, which is exactly why the
 * candidacy path uses {@link classifyVideoAsset} instead (#412). It stays as it was for the
 * `MediaSheet` compose flow, whose own null-handling predates that distinction.
 */
export function toPickedMedia(asset: ImagePickerAsset): PickedMedia | null {
  const media = normalize(asset);
  if (
    media.kind === 'video' &&
    media.duration_s != null &&
    media.duration_s > MEDIA_LIMITS.MAX_VIDEO_SECONDS
  ) {
    return null; // over cap → caller shows media.tooLong
  }
  return media;
}

/**
 * The Content-Type an upload should declare for a picked video, or `null` when the container
 * is one the bucket will refuse.
 *
 * A missing `mimeType` resolves to mp4 rather than to a rejection: the picker declining to
 * name a type is not evidence of a bad type, and mp4 is what this path declared unconditionally
 * before (#412). The difference is that a type the picker DOES name is now believed — a
 * QuickTime capture is labelled QuickTime, and `MEDIA_LIMITS.VIDEO_MIME_TYPES` (mirrored by the
 * bucket's `allowed_mime_types`) is what decides whether that label is acceptable.
 */
export function resolveVideoContentType(mimeType: string | undefined): string | null {
  if (!mimeType) return 'video/mp4';
  // A `type/subtype; codecs=…` parameter is legal and is not part of the allowlist comparison.
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  const allowed: readonly string[] = MEDIA_LIMITS.VIDEO_MIME_TYPES;
  return allowed.includes(normalized) ? normalized : null;
}

/**
 * Decide whether a picked asset can become a candidacy video, and under which Content-Type.
 *
 * Every rejection names a reason, because the bug this closes (#412) was that all of them were
 * one silent `null`. The order is the order a member would care about: the 60s cap is the rule
 * the screen advertises, the byte cap is the one that would otherwise cost minutes of upload
 * before failing, and the container check is last because it is the rarest.
 *
 * A non-video reaches here only if the picker returned one despite being launched videos-only;
 * it is rejected rather than uploaded, which is what `handle()` used to do silently.
 */
export function classifyVideoAsset(asset: ImagePickerAsset): VideoPickOutcome {
  const media = normalize(asset);
  if (media.kind !== 'video') return { outcome: 'rejected', reason: 'unsupported-type' };
  if (media.duration_s != null && media.duration_s > MEDIA_LIMITS.MAX_VIDEO_SECONDS) {
    return { outcome: 'rejected', reason: 'too-long' };
  }
  if (media.bytes != null && media.bytes > MEDIA_LIMITS.MAX_VIDEO_BYTES) {
    return { outcome: 'rejected', reason: 'too-large' };
  }
  const contentType = resolveVideoContentType(media.mimeType);
  if (contentType === null) return { outcome: 'rejected', reason: 'unsupported-type' };
  return { outcome: 'picked', media, contentType };
}
