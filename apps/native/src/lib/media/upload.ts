import * as Crypto from 'expo-crypto';
import { uploadToBucket } from '@athanor/api';
import { supabase } from '@/lib/supabase';
import type { PickedMedia } from './pick';
import { processImage, processVideo } from './process';

export type MediaBucket = 'post-media' | 'moments' | 'story-segments';

export type UploadTarget = { bucket: MediaBucket; path: string };

/** A fresh UUID for a media item (post media id, moment id, …). */
export function newMediaId(): string {
  return Crypto.randomUUID();
}

/** Storage key for a post-media item: `${uid}/${postId}/${index}.{ext}`. */
export function postMediaPath(
  uid: string,
  postId: string,
  index: number,
  kind: PickedMedia['kind'],
): string {
  return `${uid}/${postId}/${index}.${kind === 'video' ? 'mp4' : 'jpg'}`;
}

/** Storage key for a moment: `${uid}/${momentId}.{ext}`. */
export function momentPath(uid: string, momentId: string, kind: PickedMedia['kind']): string {
  return `${uid}/${momentId}.${kind === 'video' ? 'mp4' : 'jpg'}`;
}

/** Storage key for a story segment: `${uid}/${segmentId}.{ext}`. */
export function storyPath(uid: string, segmentId: string, kind: PickedMedia['kind']): string {
  return `${uid}/${segmentId}.${kind === 'video' ? 'mp4' : 'jpg'}`;
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
