import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import { createVideoPlayer, type VideoPlayer, type VideoThumbnail } from 'expo-video';
import { MEDIA_LIMITS, videoPosterTime } from '@athanor/core';
import { devWarn } from '@/lib/log';

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
 *
 * **`signal` exists because the `finally` alone was not enough (#449).** The caller bounds this
 * with `withTimeout`, which abandons the promise rather than cancelling it — so on the slow
 * asset the deadline exists for, the wizard moved on while a decoder and two bitmaps stayed
 * resident for however long the underlying work took, which is unbounded by construction. On
 * iOS that memory is added to a native heap that is already holding the whole uploaded file,
 * and the sum is what the OS kills the app over. Aborting releases immediately, and the release
 * clears each handle as it frees it — idempotent, but still effective on a handle produced
 * after the abort by a native call that was already in flight.
 */
export async function extractVideoPoster(
  uri: string,
  durationS: number | null | undefined,
  signal?: AbortSignal,
): Promise<{ uri: string; width: number; height: number } | null> {
  let player: VideoPlayer | null = null;
  let frame: VideoThumbnail | null = null;
  let image: ImageRef | null = null;

  const freeHandle = (handle: { release: () => void } | null) => {
    try {
      handle?.release();
    } catch (err) {
      // Releasing a handle the native side has already torn down throws, and there is nothing
      // left to free either way. It must not escape: this also runs from an abort listener,
      // where a throw is an unhandled error rather than a caught one.
      devWarn('poster.release', err);
    }
  };
  /**
   * Free every handle held right now and forget it.
   *
   * Clearing rather than latching, because the two calls that can reach this — the abort
   * listener and the `finally` — can interleave with an await. An abort that lands while
   * `generateThumbnailsAsync` is in flight frees the player; if that call then resolves rather
   * than throwing, `frame` is assigned afterwards and a one-shot latch would leave it alive
   * forever. Nulling makes the second call free exactly what the first could not see.
   */
  const release = () => {
    freeHandle(image);
    image = null;
    freeHandle(frame);
    frame = null;
    freeHandle(player);
    player = null;
  };
  signal?.addEventListener('abort', release);

  try {
    // Cheaper than constructing a decoder we would release on the next line.
    if (signal?.aborted) return null;
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
  } catch (err) {
    devWarn('poster.extract', err);
    return null;
  } finally {
    signal?.removeEventListener('abort', release);
    release();
  }
}
