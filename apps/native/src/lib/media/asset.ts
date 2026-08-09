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
};

/**
 * Map a picker asset → PickedMedia. Returns `null` if the asset type can't be
 * resolved to image/video (e.g. a rare Android ContentProvider `null` type), or
 * if a video exceeds the 60s cap — the caller surfaces `media.tooLong` for the
 * latter. `livePhoto`/`pairedVideo` are coerced to `image` (we never request
 * them, but be defensive).
 */
export function toPickedMedia(asset: ImagePickerAsset): PickedMedia | null {
  const isVideo = asset.type === 'video';
  const kind: 'image' | 'video' = isVideo ? 'video' : 'image';
  const durationMs = asset.duration ?? null;
  const duration_s = durationMs != null ? Math.round(durationMs / 1000) : undefined;

  if (kind === 'video' && duration_s != null && duration_s > MEDIA_LIMITS.MAX_VIDEO_SECONDS) {
    return null; // over cap → caller shows media.tooLong
  }

  return {
    kind,
    uri: asset.uri,
    width: asset.width || undefined,
    height: asset.height || undefined,
    duration_s,
    mimeType: asset.mimeType,
  };
}
