import * as Crypto from 'expo-crypto';
import { storageUploadAuth } from '@/lib/supabase';
import type { PickedMedia } from './pick';
import type { UploadTarget } from './paths';
import { processImage, processVideo } from './process';
import { buildStorageUploadRequest } from './storage-request';
import { xhrUpload, type UploadProgress } from './upload-transport';

// Pure path builders + types live in paths.ts (unit-testable, no expo imports);
// re-exported here so callers keep importing from './upload'. Same door for the
// transport's error taxonomy — callers map failures without a second import.
export * from './paths';
export {
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
 * Stream a local file into a bucket, with cancel / stall-watchdog / progress (#294).
 *
 * Sends the XHR body as `{ uri }` — RN's networking layer streams the file from disk, so a
 * 200 MB video never lands in the JS heap the way the old `fetch(uri).arrayBuffer()` read
 * did. The request mirrors the storage-js upsert upload byte for byte (storage-request.ts),
 * so a retry still overwrites the same key cleanly. Throws on failure.
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
  await xhrUpload({
    url: req.url,
    headers: req.headers,
    body: { uri: localUri },
    signal: opts.signal,
    onProgress: opts.onProgress,
  });
}

/**
 * Process one picked item and upload it to its target. Images are EXIF-stripped
 * + resized first; videos pass through (see process.ts for the honest video gap).
 *
 * Returns the processed `localUri` alongside the storage path: for a video that is the file a
 * poster frame must be extracted from, and it is not always `item.uri` — `processVideo` is a
 * passthrough today, but the moment it transcodes, a poster taken from the picked file would be
 * a frame of a video nobody uploaded.
 *
 * Awaitable and throws on failure so the caller can surface `uploadErrorKey(err)` + offer
 * retry. `opts` threads cancel/progress through to the transport; even without it, every
 * caller now gets the no-progress watchdog for free (#294).
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
  } else {
    const processed = await processVideo(item.uri);
    localUri = processed.uri;
    width = item.width;
    height = item.height;
    contentType = 'video/mp4';
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
