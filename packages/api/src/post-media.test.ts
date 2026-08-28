import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import { asClient, DB_DOWN, makeFakeClient } from './test-support/fake-client';
import { getPostMedia } from './post-media';

const POST = '00000000-0000-0000-0000-0000000000b1';
const M1 = '00000000-0000-0000-0000-0000000000d1';
const M2 = '00000000-0000-0000-0000-0000000000d2';

/** Valid `postMediaSchema` row (readers zod-parse every row). */
const BASE_MEDIA = {
  id: M1,
  post_id: POST,
  kind: 'image' as const,
  storage_path: 'post-media/u1/img-0.jpg',
  thumb_path: null,
  duration_s: null,
  width: 1080,
  height: 1350,
  position: 0,
  created_at: '2026-01-02T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

/** Thenable PostgREST-builder stub: records calls; awaiting resolves to { data, error }. */
function stub(rows: Array<Record<string, unknown>> = []) {
  const calls: Array<{ method: string; arg: unknown; arg2?: unknown }> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'order']) {
    chain[m] = (arg?: unknown, arg2?: unknown) => {
      calls.push({ method: m, arg, arg2 });
      return chain;
    };
  }
  chain['eq'] = (col: unknown, val?: unknown) => {
    calls.push({ method: 'eq', arg: col, arg2: val });
    return chain;
  };
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
    resolve({ data: rows, error: null });
  const client = {
    from: (table: unknown) => {
      calls.push({ method: 'from', arg: table });
      return chain;
    },
  } as unknown as AthanorClient;
  return { client, calls };
}

describe('getPostMedia', () => {
  it('scopes to the post and orders by position ascending', async () => {
    const { client, calls } = stub([]);
    await getPostMedia(client, POST);
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'post_id' && c.arg2 === POST)).toBe(
      true,
    );
    const order = calls.find((c) => c.method === 'order');
    expect(order?.arg).toBe('position');
    expect(order?.arg2).toEqual({ ascending: true });
  });

  it('parses every row through postMediaSchema', async () => {
    const rows = [
      { ...BASE_MEDIA, id: M1, position: 0 },
      { ...BASE_MEDIA, id: M2, position: 1, extraneous: 'stripped' },
    ];
    const { client } = stub(rows);
    const media = await getPostMedia(client, POST);
    expect(media).toHaveLength(2);
    expect(media[0]).toEqual({ ...BASE_MEDIA, id: M1, position: 0 });
    expect(media[1]).not.toHaveProperty('extraneous');
  });
});

describe('post-media — a database failure reaches the caller', () => {
  it('getPostMedia rethrows instead of rendering a post as text-only', async () => {
    const fake = makeFakeClient({ 'post_media.select': [{ error: DB_DOWN }] });
    await expect(getPostMedia(asClient(fake), POST)).rejects.toMatchObject({ code: '57P01' });
  });

  // Pins a `?? []` guard against a state that cannot actually occur — a zero-match select
  // returns []. It is here so that deleting the guard fails rather than passes, NOT as a model
  // of PostgREST behaviour.
  it('the read holds its empty-payload guard', async () => {
    const read = makeFakeClient({ 'post_media.select': [{ data: null }] });
    await expect(getPostMedia(asClient(read), POST)).resolves.toEqual([]);
  });
});
