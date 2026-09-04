import type { UploadTarget } from './paths';

/**
 * URL + headers for a direct storage-api object upload, mirroring what
 * `storage-js`'s `uploadOrUpdate` raw-body branch sends (its 2.108 source:
 * `x-upsert`, `cache-control: max-age=…`, `content-type`) so swapping the SDK
 * call for the XHR transport (#294) changes the wire shape not at all.
 *
 * Pure module — auth comes in as ready-made headers (`storageUploadAuth` in
 * supabase.ts), so this stays unit-testable with no client in sight.
 */

/** storage-js's DEFAULT_FILE_OPTIONS cacheControl — kept identical on purpose. */
export const STORAGE_CACHE_CONTROL_S = 3600;

export function buildStorageUploadRequest(opts: {
  /** The Supabase project base URL (no trailing slash needed — one is tolerated). */
  baseUrl: string;
  /** apikey / Authorization / version-gate headers, from `storageUploadAuth()`. */
  authHeaders: Record<string, string>;
  target: UploadTarget;
  contentType: string;
}): { url: string; headers: Record<string, string> } {
  const base = opts.baseUrl.endsWith('/') ? opts.baseUrl.slice(0, -1) : opts.baseUrl;
  return {
    url: `${base}/storage/v1/object/${opts.target.bucket}/${opts.target.path}`,
    headers: {
      ...opts.authHeaders,
      // Upsert always on: a retry after cancel/stall/failure overwrites the same key
      // instead of erroring on the half-written object (the #294 orphan decision).
      'x-upsert': 'true',
      'cache-control': `max-age=${STORAGE_CACHE_CONTROL_S}`,
      'content-type': opts.contentType,
    },
  };
}
