import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import { createVideoPlayer, type VideoPlayer, type VideoThumbnail } from 'expo-video';
import { MEDIA_LIMITS, videoPosterTime } from '@athanor/core';

/**
 * Extract a poster frame from a local video, as a JPEG on disk ready to upload (issue #131).
 *
 * `expo-video` hands back a `VideoThumbnail`, which is a *native image reference*, not a file —
 * it can be fed straight to `expo-image` but there are no bytes to upload. `expo-image-manipulator`
 * accepts any `SharedRef<'image'>` as a source, so rendering that reference and saving it is what
 * turns the frame into an object we can put in Storage. It is also the same JPEG re-encode
 * `processImage` performs, which means the poster carries no EXIF either.
 *
 * **Returns `null` rather than throwing on any failure.** A poster is a nicety; the Momento is
 * the point. A device that cannot decode this codec, a `PHAsset` that will not load, a frame time
 * the decoder rejects — none of those are reasons to fail an upload the member already waited on,
 * so the moment is created with `thumb_path: null` and its tile falls back (see `momentPosterPath`).
 *
 * Android/iOS only: `generateThumbnailsAsync` is not implemented on web. The Expo Go app is the
 * only surface this ships to today, so that is not a gap here — but it is why the caller must
 * treat `null` as ordinary.
 *
 * Every native handle here is a `SharedObject` that retains a bitmap or a decoder until released,
 * and `createVideoPlayer` (unlike the `useVideoPlayer` hook) has no component lifecycle to clean
 * up after it. Hence the `finally`: this runs once per video upload, and a leaked decoder per
 * upload is a real cost.
 */
export async function extractVideoPoster(
  uri: string,
  durationS: number | null | undefined,
): Promise<{ uri: string; width: number; height: number } | null> {
  let player: VideoPlayer | null = null;
  let frame: VideoThumbnail | null = null;
  let image: ImageRef | null = null;

  try {
    // Constructed empty and loaded through `replaceAsync` rather than `createVideoPlayer(uri)`:
    // that await is what guarantees the asset is loaded before we ask it for a frame, and it is
    // the only path on iOS that accepts a `PHAsset` URI (which the library picker can return).
    player = createVideoPlayer(null);
    await player.replaceAsync(uri);

    const frames = await player.generateThumbnailsAsync(videoPosterTime(durationS), {
      maxWidth: MEDIA_LIMITS.VIDEO_POSTER_MAX_EDGE,
      maxHeight: MEDIA_LIMITS.VIDEO_POSTER_MAX_EDGE,
    });
    frame = frames[0] ?? null;
    if (!frame) return null;

    image = await ImageManipulator.manipulate(frame).renderAsync();
    const saved = await image.saveAsync({
      compress: MEDIA_LIMITS.VIDEO_POSTER_QUALITY,
      format: SaveFormat.JPEG,
    });
    return { uri: saved.uri, width: saved.width, height: saved.height };
  } catch {
    return null;
  } finally {
    image?.release();
    frame?.release();
    player?.release();
  }
}
