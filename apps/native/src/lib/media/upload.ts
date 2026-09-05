import * as Crypto from 'expo-crypto';
import { storageUploadAuth } from '@/lib/supabase';
import type { PickedMedia } from './pick';
import { resolveAudioContentType, resolveVideoContentType } from './asset';
import type { UploadTarget } from './paths';
import { processImage, processVideo } from './process';
import { buildStorageUploadRequest } from './storage-request';
import { platformUploader } from './upload-task';
import { UnsupportedMediaTypeError, uploadFile, type UploadProgress } from './upload-transport';

// Pure path builders + types live in paths.ts (unit-testable, no expo imports);
// re-exported here so callers keep importing from './upload'. Same door for the
// transport's error taxonomy — callers map failures without a second import.
export * from './paths';
export {
  UnsupportedMediaTypeError,
  UploadCanceledError,
  UploadHttpError,
  UploadStalledError,
  uploadErrorKey,
  uploadFailureStatus,
} from './upload-transport';
export type { UploadProgress } from './upload-transport';

/** Optional per-upload controls; omitted = old behaviour plus the stall watchdog. */
export type UploadOptions = {
  /** Abort mid-flight; the rejection is `UploadCanceledError`. */
  signal?: AbortSignal;
  /** Byte-level progress from the native layer. */
  onProgress?: (p: UploadProgress) => void;
};

/** A fresh UUID for a media item (post media id, moment id, …). */
export function newMediaId(): string {
  return Crypto.randomUUID();
}

/**
 * Send a local file into a bucket, with cancel / stall-watchdog / progress (#294).
 *
 * The body is file-backed on every platform (#450): `upload-task.ts` hands the URI to
 * `expo-file-system`'s `UploadTask` on device, which streams it from disk at constant memory,
 * and to a browser XHR with a real `Blob` on web. Neither the JS heap nor the native heap ever
 * holds the file — which is what the previous `xhr.send({ uri })` did on iOS, one contiguous
 * `NSMutableData` before a byte left, and an OS jetsam kill inside Expo Go rather than an error
 * anything could catch. `pick.ts` still compresses, but now for upload time and for
 * `media-process`'s own ceiling, not to keep an allocation survivable.
 *
 * The request mirrors the storage-js upsert upload byte for byte (storage-request.ts), so a
 * retry still overwrites the same key cleanly. Throws on failure.
 *
 * Split out of `processAndUpload` because a video Momento uploads twice: the video itself, then
 * the poster frame `extractVideoPoster` saved (#131). Same bytes-to-Storage tail, one copy.
 */
export async function uploadLocalFile(
  localUri: string,
  target: UploadTarget,
  contentType: string,
  opts: UploadOptions = {},
): Promise<void> {
  const auth = await storageUploadAuth();
  const req = buildStorageUploadRequest({
    baseUrl: auth.baseUrl,
    authHeaders: auth.headers,
    target,
    contentType,
  });
  await uploadFile(
    {
      url: req.url,
      headers: req.headers,
      file: { uri: localUri },
      signal: opts.signal,
      onProgress: opts.onProgress,
    },
    { uploader: platformUploader },
  );
}

/**
 * Process one picked item and upload it to its target. Images are EXIF-stripped
 * + resized first; videos and recordings pass through (see process.ts for the honest video
 * gap, and the audio arm below for why there is nothing to process there).
 *
 * Returns the processed `localUri` alongside the storage path: for a video that is the file a
 * poster frame must be extracted from, and it is not always `item.uri` — `processVideo` is a
 * passthrough today, but the moment it transcodes, a poster taken from the picked file would be
 * a frame of a video nobody uploaded.
 *
 * Awaitable and throws on failure so the caller can surface `uploadErrorKey(err)` + offer
 * retry. `opts` threads cancel/progress through to the transport; even without it, every
 * caller now gets the no-progress watchdog for free (#294).
 *
 * **A video's Content-Type is resolved, never asserted (#461).** This declared `'video/mp4'`
 * for every video regardless of what the picker actually handed back, and that string reaches
 * the wire verbatim: the buckets filter on the declared header, not on the bytes, so an iPhone
 * `.mov` always passed the check while QuickTime bytes landed under an mp4 label in
 * `storage.objects.metadata`. `resolveVideoContentType` is the same door the candidacy path has
 * used since #412 — one resolver, not a second copy that drifts — and a container outside
 * `MEDIA_LIMITS.VIDEO_MIME_TYPES` is now refused by name before a byte moves, rather than
 * relabelled into acceptance. A picker that names no type at all still resolves to mp4: silence
 * is not evidence of a bad container.
 */
export async function processAndUpload(
  item: PickedMedia,
  target: UploadTarget,
  opts: UploadOptions = {},
): Promise<{
  storage_path: string;
  localUri: string;
  width?: number;
  height?: number;
  duration_s?: number;
  contentType: string;
}> {
  let localUri: string;
  let width: number | undefined;
  let height: number | undefined;
  let contentType: string;

  if (item.kind === 'image') {
    const processed = await processImage(item.uri);
    localUri = processed.uri;
    width = processed.width;
    height = processed.height;
    contentType = 'image/jpeg';
  } else if (item.kind === 'audio') {
    // A recording is uploaded exactly as the recorder wrote it: there is no `processAudio`,
    // because the two things processing does elsewhere have no audio counterpart here. The
    // EXIF strip is an image concern, and the metadata an `.m4a` can carry is stripped
    // server-side by `media-process` (`stripMp4`) the same way it is for a video.
    //
    // The container is resolved, not asserted, for the #461 reason — the bucket believes the
    // declared header, so the header is checked where it is set. `recordedAudio` already
    // refused anything outside the allowlist at the recorder door, which makes this the second
    // gate rather than the first; it stays because `processAndUpload` is reachable from any
    // caller holding a `PickedMedia`, and a bucket contract enforced only at one call site is
    // enforced by convention.
    const resolved = resolveAudioContentType(item.mimeType);
    if (resolved === null) throw new UnsupportedMediaTypeError(item.mimeType);
    localUri = item.uri;
    // Deliberately left undefined rather than read off `item`: audio has no dimensions, and a
    // 0 written into `width`/`height` would make `aspectRatio()` divide by zero in the feed.
    contentType = resolved;
  } else {
    // Before the processing pass, not after: `processVideo` is a passthrough today, so a
    // container the bucket refuses would otherwise be discovered only once the bytes are
    // already on the wire and the 415 comes back as «non riuscito».
    const resolved = resolveVideoContentType(item.mimeType);
    if (resolved === null) throw new UnsupportedMediaTypeError(item.mimeType);
    const processed = await processVideo(item.uri);
    localUri = processed.uri;
    width = item.width;
    height = item.height;
    contentType = resolved;
  }

  await uploadLocalFile(localUri, target, contentType, opts);

  return {
    storage_path: target.path,
    localUri,
    width,
    height,
    duration_s: item.duration_s,
    contentType,
  };
}
