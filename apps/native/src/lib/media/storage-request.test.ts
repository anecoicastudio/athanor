import { describe, expect, it } from 'vitest';
import { STORAGE_CACHE_CONTROL_S, buildStorageUploadRequest } from './storage-request';

describe('buildStorageUploadRequest', () => {
  const authHeaders = { apikey: 'pk', Authorization: 'Bearer tok', 'x-app-version': '1.2.3' };

  it('targets storage-api object endpoint `{base}/storage/v1/object/{bucket}/{path}`', () => {
    const { url } = buildStorageUploadRequest({
      baseUrl: 'https://ref.supabase.co',
      authHeaders,
      target: { bucket: 'candidacy-videos', path: 'u1/c1.mp4' },
      contentType: 'video/mp4',
    });
    expect(url).toBe('https://ref.supabase.co/storage/v1/object/candidacy-videos/u1/c1.mp4');
  });

  it('tolerates a trailing slash on the base URL without doubling it', () => {
    const { url } = buildStorageUploadRequest({
      baseUrl: 'https://ref.supabase.co/',
      authHeaders,
      target: { bucket: 'moments', path: 'u1/m1.jpg' },
      contentType: 'image/jpeg',
    });
    expect(url).toBe('https://ref.supabase.co/storage/v1/object/moments/u1/m1.jpg');
  });

  it('carries the auth headers plus the storage-js raw-body trio', () => {
    const { headers } = buildStorageUploadRequest({
      baseUrl: 'https://ref.supabase.co',
      authHeaders,
      target: { bucket: 'moments', path: 'u1/m1.jpg' },
      contentType: 'image/jpeg',
    });
    expect(headers).toEqual({
      ...authHeaders,
      // Upsert on = retry-overwrites-the-same-key, the #294 orphan decision.
      'x-upsert': 'true',
      'cache-control': `max-age=${STORAGE_CACHE_CONTROL_S}`,
      'content-type': 'image/jpeg',
    });
  });

  it('does not mutate the caller-owned auth headers object', () => {
    const frozen = Object.freeze({ apikey: 'pk' });
    buildStorageUploadRequest({
      baseUrl: 'https://ref.supabase.co',
      authHeaders: frozen,
      target: { bucket: 'avatars', path: 'u1/u1.jpg' },
      contentType: 'image/jpeg',
    });
    expect(frozen).toEqual({ apikey: 'pk' });
  });
});
