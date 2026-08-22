import type { AthanorClient } from './client';

/** The private media buckets. */
export type MediaBucketName =
  | 'post-media'
  | 'moments'
  | 'story-segments'
  | 'candidacy-videos'
  | 'avatars';

/** Upload bytes to a private bucket at an exact key. `upsert` replaces on retry. */
export async function uploadToBucket(
  client: AthanorClient,
  bucket: MediaBucketName,
  path: string,
  body: ArrayBuffer | Blob | Uint8Array,
  contentType: string,
): Promise<void> {
  const { error } = await client.storage.from(bucket).upload(path, body, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
}

/**
 * Delete objects from a private bucket. Dedupes and drops falsy paths like `signMediaUrls`,
 * and no-ops on an empty list rather than issuing a request that deletes nothing.
 *
 * Throws on failure, like `uploadToBucket`. storage-js reports a failed remove as a resolved
 * `{ error }` and a network fault as a rejection, so a caller that handles only one of the two
 * leaves the other unhandled (#179) — collapsing both into a throw here means one `.catch` at
 * the call site covers it.
 */
export async function removeFromBucket(
  client: AthanorClient,
  bucket: MediaBucketName,
  paths: string[],
): Promise<void> {
  const unique = [...new Set(paths)].filter(Boolean);
  if (unique.length === 0) return;
  const { error } = await client.storage.from(bucket).remove(unique);
  if (error) throw error;
}

/**
 * Signed-URL lifetime per bucket, in seconds.
 *
 * `story-segments` is the outlier and the reason this table exists rather than a single default.
 * A storage RLS predicate is evaluated when a URL is MINTED, not when it is used, so for a
 * bucket whose objects EXPIRE the TTL is the residual exposure after expiry —
 * `20260809151111_story_segment_storage_expiry.sql` hides a segment's bytes the moment its row
 * goes, but a URL signed a minute earlier keeps working for its whole life regardless. At the 1h
 * default that is an hour of a story the member was told had gone (PRD §4.5). Five minutes is
 * comfortably longer than a segment is on screen and short enough that expiry means something.
 *
 * It lives HERE, not at the call site, so the guarantee cannot be lost by forgetting an
 * argument: this package is the only door to `createSignedUrls`, and `apps/web` returning means
 * new callers. Raising the story-segment number re-opens the hole and no SQL will notice.
 *
 * The other buckets have no expiry, so their TTL bounds nothing and a shorter one would only
 * cost round trips.
 */
export const BUCKET_URL_TTL = {
  'post-media': 3600,
  moments: 3600,
  'story-segments': 300,
  'candidacy-videos': 3600,
  // An avatar is on screen in every list the member appears in, and its key is deterministic
  // (`{uid}/{uid}.{ext}`), so one signed URL is reused across screens for the whole hour rather
  // than re-minted per row. Nothing expires in this bucket, so the TTL bounds no deletion.
  avatars: 3600,
} as const satisfies Record<MediaBucketName, number>;

/**
 * Short-lived signed URLs for private media. Returns a path→url map; paths that
 * fail to sign are omitted (caller renders a placeholder). Lifetime defaults to the bucket's
 * entry in `BUCKET_URL_TTL` — pass `expiresIn` only to go SHORTER, never longer.
 */
export async function signMediaUrls(
  client: AthanorClient,
  bucket: MediaBucketName,
  paths: string[],
  expiresIn: number = BUCKET_URL_TTL[bucket],
): Promise<Record<string, string>> {
  const unique = [...new Set(paths)].filter(Boolean);
  if (unique.length === 0) return {};
  const { data, error } = await client.storage.from(bucket).createSignedUrls(unique, expiresIn);
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.signedUrl && row.path) out[row.path] = row.signedUrl;
  }
  return out;
}
