import {
  ImageManipulator,
  SaveFormat,
  type ImageManipulatorContext,
  type ImageRef,
} from 'expo-image-manipulator';
import { createVideoPlayer, type VideoPlayer, type VideoThumbnail } from 'expo-video';
import { MEDIA_LIMITS, videoPosterTime } from '@athanor/core';
import { markStep } from '@/lib/crash-trail';
import { devWarn } from '@/lib/log';

/**
 * The single call site of `generateThumbnailsAsync`, and the only place a frame time is
 * marshalled across the JS/native boundary (#449).
 *
 * It exists to make one mistake unrepeatable. `expo-video` types the parameter
 * `times: number | number[]`, and the first half of that union is a lie: iOS declares
 * `times: [CMTime]?` and `expo-modules-core` converts it with `DynamicArrayType`, which calls
 * `jsValue.getArray()` with no `isObject()` check — the only guard is an `assert(isObject())`
 * inside `EXJavaScriptValue`, and asserts are compiled out of a Release build, which is what
 * Expo Go ships. A bare number therefore has its double bit pattern dereferenced as an object
 * pointer: a deterministic `EXC_BAD_ACCESS` with no JS exception, so nothing is catchable and
 * nothing reaches Metro.
 *
 * Android does not tolerate it either — it fails differently, which is why this went unseen for
 * so long. `VideoModule.kt` declares `times: List<Duration>`, non-nullable, so a scalar raises a
 * catchable Kotlin conversion error that `extractVideoPoster`'s `catch` turns into a `null`
 * poster: no crash, no log, just a thumbnail that never appears. Video posters have therefore
 * never worked on either platform, and passing the array repairs both.
 *
 * Taking a scalar `atSeconds` and wrapping it here keeps that ABI detail at the boundary that
 * owns it: `videoPosterTime` stays a pure `number` in `@athanor/core`, where array-ness would
 * be a native module's marshalling quirk leaking into domain logic.
 */
function generateThumbnails(player: VideoPlayer, atSeconds: number): Promise<VideoThumbnail[]> {
  return player.generateThumbnailsAsync([atSeconds], {
    maxWidth: MEDIA_LIMITS.VIDEO_POSTER_MAX_EDGE,
    maxHeight: MEDIA_LIMITS.VIDEO_POSTER_MAX_EDGE,
  });
}

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
 * the point. A device that cannot decode this codec, an asset that will not load, a frame time
 * the decoder rejects — none of those are reasons to fail an upload the member already waited on,
 * so the moment is created with `thumb_path: null` and its tile falls back (see `momentPosterPath`).
 *
 * Android/iOS only: `generateThumbnailsAsync` is not implemented on web. The Expo Go app is the
 * only surface this ships to today, so that is not a gap here — but it is why the caller must
 * treat `null` as ordinary.
 *
 * **`replaceAsync` does not guarantee the item is loaded**, so an empty result is a real outcome
 * rather than a theoretical one. The native implementation ends in a `DispatchQueue.main.async`
 * block and resolves before that block runs, so `generateThumbnailsAsync` can find
 * `currentItem == nil` and hand back `[]`. That is why it is `replaceAsync` and not
 * `createVideoPlayer(uri)` — it is still the closest thing to "loaded" the API offers — and why
 * the empty case is logged instead of collapsing quietly into a posterless submission.
 *
 * Every native handle here is a `SharedObject` that retains a bitmap or a decoder until released:
 * the player, the frame, the manipulator context (which holds the source image alive for as long
 * as it exists), and the rendered image. `createVideoPlayer` — unlike the `useVideoPlayer` hook —
 * has no component lifecycle to clean up after it, hence the `finally`.
 *
 * **The `finally` is the only place anything is released, deliberately (#449).** `signal` cancels
 * by short-circuiting the next step, never by freeing a handle where it fires: `release()` does
 * not cancel native work, it drops the last strong reference, so `VideoPlayer.deinit` — eleven
 * KVO invalidations plus a NotificationCenter teardown — would run off the main thread, possibly
 * while `AVAssetImageGenerator` is still using the item. expo's own comment in
 * `ios/VideoPlayer.swift` says exactly that ("causes crashes"). An abort that lands mid-call
 * therefore costs one native call's worth of latency before the handles go — the alternative
 * traded a bounded wait for an unbounded crash.
 *
 * **The `markStep` calls are durable diagnostics, not logging (#452).** This function is the
 * proven case: #449 killed the process inside `generateThumbnailsAsync` with no JS exception, so
 * the `catch` below never ran, `devWarn` never fired, and the queued Metro line died with the
 * process. Each marker is awaited immediately before a native call that can do that again, which
 * is the only ordering that works — an un-awaited marker is in flight when the process dies, and
 * buys exactly nothing. `crash-trail.ts` carries the evidence that an awaited write means bytes
 * on disk, and pays for it with one bridge round-trip per marker. `poster.done` exists so a
 * completed extraction does not read as the crash point on the next launch.
 */
export async function extractVideoPoster(
  uri: string,
  durationS: number | null | undefined,
  signal?: AbortSignal,
): Promise<{ uri: string; width: number; height: number } | null> {
  let player: VideoPlayer | null = null;
  let frame: VideoThumbnail | null = null;
  let context: ImageManipulatorContext | null = null;
  let image: ImageRef | null = null;

  const freeHandle = (handle: { release: () => void } | null) => {
    try {
      handle?.release();
    } catch (err) {
      // Releasing a handle the native side has already torn down throws, and there is nothing
      // left to free either way — a poster is best-effort, so this cannot become the reason a
      // submission fails.
      devWarn('poster.release', err);
    }
  };

  // Cheaper than constructing a decoder we would release on the next line. Outside the `try`
  // because it holds nothing: there is no handle for the `finally` to free and no marker for it
  // to spend a bridge round-trip on.
  if (signal?.aborted) return null;

  try {
    await markStep('poster.player');
    player = createVideoPlayer(null);
    await player.replaceAsync(uri);

    if (signal?.aborted) return null;
    await markStep('poster.thumbnails');
    const frames = await generateThumbnails(player, videoPosterTime(durationS));
    frame = frames[0] ?? null;

    // Before the empty check, not after: a cancellation that lands mid-generation can also
    // come back with `[]`, and logging 'no frame' for it would blame the decoder for a
    // deadline the caller set.
    if (signal?.aborted) return null;
    if (!frame) {
      // i18n-ignore — a __DEV__-only diagnostic tag, never rendered.
      devWarn('poster.extract', 'no frame generated');
      return null;
    }

    await markStep('poster.render');
    context = ImageManipulator.manipulate(frame);
    image = await context.renderAsync();

    if (signal?.aborted) return null;
    await markStep('poster.save');
    const saved = await image.saveAsync({
      compress: MEDIA_LIMITS.VIDEO_POSTER_QUALITY,
      format: SaveFormat.JPEG,
    });
    return { uri: saved.uri, width: saved.width, height: saved.height };
  } catch (err) {
    devWarn('poster.extract', err);
    return null;
  } finally {
    await markStep('poster.release');
    freeHandle(image);
    freeHandle(context);
    freeHandle(frame);
    freeHandle(player);
    await markStep('poster.done');
  }
}
