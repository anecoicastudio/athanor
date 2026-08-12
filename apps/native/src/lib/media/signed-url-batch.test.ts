import { describe, expect, it, vi } from 'vitest';
import { createSignedUrlBatcher } from './signed-url-batch';

const url = (p: string) => `https://signed.example/${p}`;

describe('createSignedUrlBatcher', () => {
  it('signs every path requested in one tick with a single call', async () => {
    const sign = vi.fn(async (paths: string[]) =>
      Object.fromEntries(paths.map((p) => [p, url(p)])),
    );
    const resolve = createSignedUrlBatcher(sign);

    // What a list render looks like: N rows, N leaves, all mounting in the same pass.
    const results = await Promise.all(['a/a.jpg', 'b/b.jpg', 'c/c.jpg'].map(resolve));

    expect(sign).toHaveBeenCalledTimes(1);
    expect(results).toEqual([url('a/a.jpg'), url('b/b.jpg'), url('c/c.jpg')]);
  });

  it('deduplicates a path two rows ask for at once', async () => {
    const sign = vi.fn(async (paths: string[]) =>
      Object.fromEntries(paths.map((p) => [p, url(p)])),
    );
    const resolve = createSignedUrlBatcher(sign);

    const [first, second] = await Promise.all([resolve('a/a.jpg'), resolve('a/a.jpg')]);

    expect(sign).toHaveBeenCalledWith(['a/a.jpg']);
    expect(first).toBe(url('a/a.jpg'));
    expect(second).toBe(url('a/a.jpg'));
  });

  it('starts a fresh batch after the previous one has flushed', async () => {
    const sign = vi.fn(async (paths: string[]) =>
      Object.fromEntries(paths.map((p) => [p, url(p)])),
    );
    const resolve = createSignedUrlBatcher(sign);

    await resolve('a/a.jpg');
    await resolve('b/b.jpg');

    expect(sign).toHaveBeenCalledTimes(2);
    expect(sign).toHaveBeenNthCalledWith(2, ['b/b.jpg']);
  });

  it('resolves null for a path the signer omitted, so the row falls back to the initial', async () => {
    // Storage RLS denies a blocked pair's avatar; `signMediaUrls` drops those paths silently.
    const resolve = createSignedUrlBatcher(async () => ({}));
    await expect(resolve('a/a.jpg')).resolves.toBeNull();
  });

  it('rejects every waiter when the signer throws, rather than hanging the batch', async () => {
    const resolve = createSignedUrlBatcher(async () => {
      throw new Error('storage down');
    });
    const first = resolve('a/a.jpg');
    const second = resolve('b/b.jpg');
    await expect(first).rejects.toThrow('storage down');
    await expect(second).rejects.toThrow('storage down');
  });
});
