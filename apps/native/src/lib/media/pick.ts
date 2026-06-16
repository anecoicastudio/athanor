import * as ImagePicker from 'expo-image-picker';
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
 * SDK-54 `mediaTypes` is an array of the `MediaType` string union
 * (`'images' | 'videos' | 'livePhotos'`) — the old `MediaTypeOptions` enum is
 * deprecated. We never pass `livePhotos` (we want a plain still, not a paired
 * video). The picker's own `quality` is the canonical `MEDIA_LIMITS.IMAGE_QUALITY`
 * (rule #10 — one source, no scattered magic numbers); the real EXIF strip + resize
 * happens later in process.ts.
 */
type ImagePickerAsset = ImagePicker.ImagePickerAsset;

function firstAsset(result: ImagePicker.ImagePickerResult): ImagePicker.ImagePickerAsset | null {
  if (result.canceled) return null;
  return result.assets[0] ?? null;
}

/**
 * Map a picker asset → PickedMedia. Returns `null` if the asset type can't be
 * resolved to image/video (e.g. a rare Android ContentProvider `null` type), or
 * if a video exceeds the 60s cap — the caller surfaces `media.tooLong` for the
 * latter. `livePhoto`/`pairedVideo` are coerced to `image` (we never request
 * them, but be defensive).
 */
function toPickedMedia(asset: ImagePickerAsset): PickedMedia | null {
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

/** Open the camera to take a photo. Requires the camera permission be granted. */
export async function capturePhoto(): Promise<PickedMedia | null> {
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: MEDIA_LIMITS.IMAGE_QUALITY,
    exif: false,
  });
  const asset = firstAsset(result);
  return asset ? toPickedMedia(asset) : null;
}

/** Open the camera to record a video, capped at MAX_VIDEO_SECONDS. */
export async function recordVideo(): Promise<PickedMedia | null> {
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['videos'],
    videoMaxDuration: MEDIA_LIMITS.MAX_VIDEO_SECONDS,
  });
  const asset = firstAsset(result);
  return asset ? toPickedMedia(asset) : null;
}

/**
 * Open the library to pick one item. `allowVideo` widens the media types to
 * include video; single-selection only (multi-image compose is a later task).
 */
export async function pickFromLibrary(opts?: {
  allowVideo?: boolean;
}): Promise<PickedMedia | null> {
  const mediaTypes: ImagePicker.MediaType[] = opts?.allowVideo ? ['images', 'videos'] : ['images'];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes,
    quality: MEDIA_LIMITS.IMAGE_QUALITY,
    videoMaxDuration: MEDIA_LIMITS.MAX_VIDEO_SECONDS,
    exif: false,
    allowsMultipleSelection: false,
  });
  const asset = firstAsset(result);
  return asset ? toPickedMedia(asset) : null;
}
