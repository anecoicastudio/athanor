import * as ImagePicker from 'expo-image-picker';
import { MEDIA_LIMITS } from '@athanor/core';
import { type PickedMedia, toPickedMedia } from './asset';

/**
 * SDK-54 `mediaTypes` is an array of the `MediaType` string union
 * (`'images' | 'videos' | 'livePhotos'`) — the old `MediaTypeOptions` enum is
 * deprecated. We never pass `livePhotos` (we want a plain still, not a paired
 * video). The picker's own `quality` is the canonical `MEDIA_LIMITS.IMAGE_QUALITY`
 * (rule #10 — one source, no scattered magic numbers); the real EXIF strip + resize
 * happens later in process.ts.
 */

// `PickedMedia` + the asset→PickedMedia mapping live in ./asset, which imports
// expo-image-picker for types only and so stays reachable from the node test
// runner. Re-exported so existing `from './pick'` imports keep resolving.
export type { PickedMedia };

/** The single selected asset, or null when the user cancelled. */
function firstAsset(result: ImagePicker.ImagePickerResult): ImagePicker.ImagePickerAsset | null {
  if (result.canceled) return null;
  return result.assets[0] ?? null;
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
