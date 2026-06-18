import type { AthanorClient } from './client';

/** Upload bytes to a private bucket at an exact key. `upsert` replaces on retry. */
export async function uploadToBucket(
  client: AthanorClient,
  bucket: 'post-media' | 'moments' | 'story-segments' | 'candidacy-videos',
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
 * Short-lived signed URLs for private media. Returns a path→url map; paths that
 * fail to sign are omitted (caller renders a placeholder). Default 1h expiry.
 */
export async function signMediaUrls(
  client: AthanorClient,
  bucket: 'post-media' | 'moments' | 'story-segments' | 'candidacy-videos',
  paths: string[],
  expiresIn = 3600,
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
