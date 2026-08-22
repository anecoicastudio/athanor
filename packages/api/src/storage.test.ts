import { describe, expect, it, vi } from 'vitest';
import type { AthanorClient } from './client';
import { removeFromBucket, signMediaUrls, uploadToBucket } from './storage';

/** Storage stub: client.storage.from(bucket) → { upload, createSignedUrls, remove } vi.fns. */
function storageStub(
  signed: Array<{ path: string | null; signedUrl: string | null }> | null = [],
  signError: unknown = null,
  uploadError: unknown = null,
  removeError: unknown = null,
) {
  const upload = vi.fn().mockResolvedValue({ data: null, error: uploadError });
  const createSignedUrls = vi.fn().mockResolvedValue({ data: signed, error: signError });
  const remove = vi.fn().mockResolvedValue({ data: null, error: removeError });
  const from = vi.fn().mockReturnValue({ upload, createSignedUrls, remove });
  const client = { storage: { from } } as unknown as AthanorClient;
  return { client, from, upload, createSignedUrls, remove };
}

describe('uploadToBucket', () => {
  it('uploads to the bucket/path with contentType and upsert:true', async () => {
    const { client, from, upload } = storageStub();
    const body = new Uint8Array([1, 2, 3]);
    await uploadToBucket(client, 'moments', 'moments/u1/a.jpg', body, 'image/jpeg');
    expect(from).toHaveBeenCalledWith('moments');
    expect(upload).toHaveBeenCalledWith('moments/u1/a.jpg', body, {
      contentType: 'image/jpeg',
      upsert: true,
    });
  });

  it('throws on upload error', async () => {
    const { client } = storageStub([], null, new Error('bucket full'));
    await expect(
      uploadToBucket(client, 'post-media', 'p/a.jpg', new Uint8Array(), 'image/jpeg'),
    ).rejects.toThrow('bucket full');
  });
});

describe('signMediaUrls', () => {
  it('dedupes paths and filters falsy entries before signing', async () => {
    const { client, createSignedUrls } = storageStub([
      { path: 'a.jpg', signedUrl: 'https://s/a' },
      { path: 'b.jpg', signedUrl: 'https://s/b' },
    ]);
    const out = await signMediaUrls(client, 'post-media', ['a.jpg', 'a.jpg', '', 'b.jpg']);
    expect(createSignedUrls).toHaveBeenCalledWith(['a.jpg', 'b.jpg'], 3600);
    expect(out).toEqual({ 'a.jpg': 'https://s/a', 'b.jpg': 'https://s/b' });
  });

  it('returns {} for an empty path list without calling createSignedUrls', async () => {
    const { client, createSignedUrls } = storageStub();
    await expect(signMediaUrls(client, 'moments', [])).resolves.toEqual({});
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it('all-falsy paths short-circuit the same way', async () => {
    const { client, createSignedUrls } = storageStub();
    await expect(signMediaUrls(client, 'moments', ['', ''])).resolves.toEqual({});
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it('passes a custom expiresIn through (default is 3600)', async () => {
    const { client, createSignedUrls } = storageStub([]);
    await signMediaUrls(client, 'story-segments', ['a.jpg'], 60);
    expect(createSignedUrls).toHaveBeenCalledWith(['a.jpg'], 60);
  });

  it('omits rows missing path or signedUrl (caller renders a placeholder)', async () => {
    const { client } = storageStub([
      { path: 'ok.jpg', signedUrl: 'https://s/ok' },
      { path: 'nope.jpg', signedUrl: null },
      { path: null, signedUrl: 'https://s/orphan' },
    ]);
    await expect(
      signMediaUrls(client, 'candidacy-videos', ['ok.jpg', 'nope.jpg', 'x.jpg']),
    ).resolves.toEqual({ 'ok.jpg': 'https://s/ok' });
  });

  it('tolerates null data (empty map)', async () => {
    const { client } = storageStub(null);
    await expect(signMediaUrls(client, 'moments', ['a.jpg'])).resolves.toEqual({});
  });

  it('throws on signing error', async () => {
    const { client } = storageStub(null, new Error('sign failed'));
    await expect(signMediaUrls(client, 'moments', ['a.jpg'])).rejects.toThrow('sign failed');
  });
});

describe('removeFromBucket', () => {
  it('removes the deduped, falsy-filtered paths from the named bucket', async () => {
    const { client, from, remove } = storageStub();
    await removeFromBucket(client, 'moments', ['a.jpg', 'a.jpg', '', 'b.jpg']);
    expect(from).toHaveBeenCalledWith('moments');
    expect(remove).toHaveBeenCalledWith(['a.jpg', 'b.jpg']);
  });

  it('no-ops on an empty list rather than issuing a request that deletes nothing', async () => {
    const { client, remove } = storageStub();
    await removeFromBucket(client, 'moments', []);
    expect(remove).not.toHaveBeenCalled();
  });

  it('all-falsy paths short-circuit the same way', async () => {
    const { client, remove } = storageStub();
    await removeFromBucket(client, 'moments', ['', '']);
    expect(remove).not.toHaveBeenCalled();
  });

  it('throws the resolved `{ error }` storage-js reports, so one .catch covers both shapes', async () => {
    const { client } = storageStub([], null, null, new Error('object not found'));
    await expect(removeFromBucket(client, 'moments', ['a.jpg'])).rejects.toThrow(
      'object not found',
    );
  });
});
