import * as Crypto from 'expo-crypto';
import { uploadToBucket } from '@athanor/api';
import { supabase } from '@/lib/supabase';
import type { PickedMedia } from './pick';
import type { UploadTarget } from './paths';
import { processImage, processVideo } from './process';

// Pure path builders + types live in paths.ts (unit-testable, no expo imports);
// re-exported here so callers keep importing from './upload'.
export * from './paths';

/** A fresh UUID for a media item (post media id, moment id, …). */
export function newMediaId(): string {
  return Crypto.randomUUID();
}

/**
 * Process one picked item and upload it to its target. Images are EXIF-stripped
 * + resized first; videos pass through (see process.ts for the honest video gap).
 *
 * Reads the local file via `fetch(uri).arrayBuffer()` — RN supports this for
 * `file://` URIs returned by the picker/manipulator — and hands the bytes to the
 * shared `uploadToBucket` helper (which upserts, so a retry overwrites cleanly).
 *
 * Awaitable and throws on failure so the caller can surface `media.failed` +
 * offer retry. TODO(later): upload progress + cancellation (XHR/AbortController);
 * the storage SDK upload here is fire-and-await with no progress signal yet.
 */
export async function processAndUpload(
  item: PickedMedia,
  target: UploadTarget,
): Promise<{
  storage_path: string;
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

  const res = await fetch(localUri);
  const bytes = await res.arrayBuffer();

  await uploadToBucket(supabase, target.bucket, target.path, bytes, contentType);

  return {
    storage_path: target.path,
    width,
    height,
    duration_s: item.duration_s,
    contentType,
  };
}
