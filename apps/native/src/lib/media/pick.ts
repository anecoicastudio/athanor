import * as ImagePicker from 'expo-image-picker';
import { MEDIA_LIMITS } from '@athanor/core';
import {
  type PickedMedia,
  type VideoPickOutcome,
  classifyVideoAsset,
  toPickedMedia,
} from './asset';

/**
 * SDK-54 `mediaTypes` is an array of the `MediaType` string union
 * (`'images' | 'videos' | 'livePhotos'`) — the old `MediaTypeOptions` enum is
 * deprecated. We never pass `livePhotos` (we want a plain still, not a paired
 * video). The picker's own `quality` is the canonical `MEDIA_LIMITS.IMAGE_QUALITY`
 * (rule #10 — one source, no scattered magic numbers); the real EXIF strip + resize
 * happens later in process.ts.
 *
 * **Every launch that can return a video also asks iOS to compress it (#449).** The picker's
 * defaults are `videoQuality: High` (record at the device maximum — 4K/60 is ~400 MB per
 * minute) and `videoExportPreset: Passthrough` (library: no transcode at all), and nothing
 * downstream ever re-encodes a video: `process.ts` is image-only. That is survivable on
 * Android, where `xhr.send({ uri })` streams from disk, and fatal on iOS, where the whole file
 * becomes one native allocation before the request leaves — an OS jetsam kill with no JS
 * exception to catch. Compressing here is the only lever available inside Expo Go, so it is
 * applied at every door, not only the candidacy one. The values live in `MEDIA_LIMITS` and are
 * enum member NAMES, indexed below so a renamed member is a type error.
 */

// `PickedMedia` + the asset→PickedMedia mapping live in ./asset, which imports
// expo-image-picker for types only and so stays reachable from the node test
// runner. Re-exported so existing `from './pick'` imports keep resolving.
export type { PickedMedia, VideoPickOutcome };

/** A candidacy video pick: an accepted asset, a named rejection, or the member backing out. */
export type VideoPickResult = VideoPickOutcome | { outcome: 'canceled' };

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
    videoQuality:
      ImagePicker.UIImagePickerControllerQualityType[MEDIA_LIMITS.VIDEO_CAPTURE_QUALITY_IOS],
  });
  const asset = firstAsset(result);
  return asset ? toPickedMedia(asset) : null;
}

/**
 * Pick ONE video for the candidacy wizard, from the camera or the library, and say what came
 * back (#412).
 *
 * Separate from `recordVideo`/`pickFromLibrary` because those answer `PickedMedia | null`, and
 * that `null` conflates three different things — the member cancelled, the video was over the
 * 60s cap, the asset was not a video. Step 4 has to tell them apart to say anything useful, so
 * this door returns a classified outcome instead.
 *
 * The library launch is videos-only. The candidacy path used to pass `allowVideo: true`, which
 * offers `['images','videos']`: picking a photo there produced a `PickedMedia` the upload hook
 * then discarded on `kind !== 'video'` without a word — an eighth silent outcome, closed here
 * by not offering the choice.
 *
 * `videoMaxDuration` is passed to the camera because it genuinely stops the recording; the
 * library ignores it for selection, which is why the duration cap is re-checked on the asset.
 */
export async function pickVideo(source: 'record' | 'library'): Promise<VideoPickResult> {
  const result =
    source === 'record'
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['videos'],
          videoMaxDuration: MEDIA_LIMITS.MAX_VIDEO_SECONDS,
          videoQuality:
            ImagePicker.UIImagePickerControllerQualityType[MEDIA_LIMITS.VIDEO_CAPTURE_QUALITY_IOS],
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['videos'],
          videoMaxDuration: MEDIA_LIMITS.MAX_VIDEO_SECONDS,
          exif: false,
          allowsMultipleSelection: false,
          videoExportPreset:
            ImagePicker.VideoExportPreset[MEDIA_LIMITS.VIDEO_LIBRARY_EXPORT_PRESET_IOS],
        });
  const asset = firstAsset(result);
  if (!asset) return { outcome: 'canceled' };
  return classifyVideoAsset(asset);
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
    // Ignored for a still; the option is set unconditionally because `allowVideo` is the
    // caller's business and a video that slipped through uncompressed is the crash.
    videoExportPreset: ImagePicker.VideoExportPreset[MEDIA_LIMITS.VIDEO_LIBRARY_EXPORT_PRESET_IOS],
  });
  const asset = firstAsset(result);
  return asset ? toPickedMedia(asset) : null;
}
