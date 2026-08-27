import { describe, expect, it } from 'vitest';
import type { PostMediaInsert } from '@athanor/schemas';
import type { AthanorClient } from './client';
import { asClient, DB_DOWN, makeFakeClient } from './test-support/fake-client';
import { getPostMedia, replacePostMedia } from './post-media';

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

/** One well-formed insert row; `over` names the fields a case actually cares about. */
const row = (over: Partial<PostMediaInsert> = {}): PostMediaInsert => ({
  post_id: POST,
  kind: 'image',
  storage_path: 'post-media/u1/img-0.jpg',
  position: 0,
  thumb_path: null,
  duration_s: null,
  width: null,
  height: null,
  ...over,
});

describe('replacePostMedia', () => {
  it('upserts every row in one batch on the (post_id, position) index, not the PK', async () => {
    const fake = makeFakeClient({
      'post_media.upsert': [
        {
          data: [
            { ...BASE_MEDIA, id: M2, position: 1 },
            { ...BASE_MEDIA, id: M1, position: 0 },
          ],
        },
      ],
    });
    const media = await replacePostMedia(asClient(fake), POST, [
      row({ position: 0 }),
      row({ position: 1, storage_path: 'post-media/u1/img-1.jpg' }),
    ]);

    const upserts = fake.calls.filter((c) => c.op === 'upsert');
    expect(upserts).toHaveLength(1); // one batch, not per-row
    expect(upserts[0]?.values).toEqual([
      row({ position: 0 }),
      row({ position: 1, storage_path: 'post-media/u1/img-1.jpg' }),
    ]);
    // The conflict target is the whole point. `postMediaInsertSchema` carries no `id`, so the
    // default (primary key) target makes every row new and answers the retry with the 23505
    // this function exists to stop.
    expect(upserts[0]?.options).toEqual({ onConflict: 'post_id,position' });
    // PostgREST returns an upsert's rows unordered; the caller gets them in render order.
    expect(media.map((m) => m.position)).toEqual([0, 1]);
  });

  it('sweeps only the positions the new set does not fill, scoped to the post', async () => {
    const fake = makeFakeClient({ 'post_media.upsert': [{ data: [BASE_MEDIA] }] });
    await replacePostMedia(asClient(fake), POST, [row({ position: 0 })]);

    const del = fake.calls.find((c) => c.op === 'delete');
    expect(del?.table).toBe('post_media');
    expect(del?.filters).toEqual([
      ['eq', 'post_id', POST],
      ['not', 'position', 'in', '(0)'],
    ]);
  });

  it('upserts BEFORE it deletes — the reverse order publishes a post with no media', async () => {
    const fake = makeFakeClient({ 'post_media.upsert': [{ data: [BASE_MEDIA] }] });
    await replacePostMedia(asClient(fake), POST, [row()]);
    expect(fake.calls.map((c) => c.op)).toEqual(['upsert', 'delete']);
  });

  it('an EMPTY set writes nothing and deletes every media row of the post', async () => {
    // The case an `if (rows.length > 0)` guard at the call site cannot see: a member who
    // removed every attachment between a lost response and the re-tap. Without the unfiltered
    // delete the first attempt's rows outlive the draft that no longer claims them.
    const fake = makeFakeClient();
    const media = await replacePostMedia(asClient(fake), POST, []);
    expect(media).toEqual([]);
    expect(fake.calls.map((c) => c.op)).toEqual(['delete']); // no upsert at all
    expect(fake.calls[0]?.filters).toEqual([['eq', 'post_id', POST]]); // no position filter
  });

  it('an invalid row anywhere in the batch throws via zod BEFORE any db call', async () => {
    const fake = makeFakeClient();
    await expect(
      replacePostMedia(asClient(fake), POST, [row({ position: 0 }), row({ position: -1 })]),
    ).rejects.toThrow();
    expect(fake.calls).toHaveLength(0); // fake untouched — not even from()
  });

  it('a row belonging to another post is refused before either statement', async () => {
    // Destructive if it were not: the row would be upserted onto THAT post while the delete
    // swept this one.
    const fake = makeFakeClient();
    await expect(replacePostMedia(asClient(fake), POST, [row({ post_id: M2 })])).rejects.toThrow(
      /another|row for post/i,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it('two rows sharing a position are refused before either statement', async () => {
    // ON CONFLICT cannot affect a row twice in one command; Postgres reports that as a fault
    // of the statement, which says nothing about the set the caller handed over.
    const fake = makeFakeClient();
    await expect(
      replacePostMedia(asClient(fake), POST, [row({ position: 1 }), row({ position: 1 })]),
    ).rejects.toThrow(/share a position/);
    expect(fake.calls).toHaveLength(0);
  });
});

describe('post-media — a database failure reaches the caller', () => {
  it('getPostMedia rethrows instead of rendering a post as text-only', async () => {
    const fake = makeFakeClient({ 'post_media.select': [{ error: DB_DOWN }] });
    await expect(getPostMedia(asClient(fake), POST)).rejects.toMatchObject({ code: '57P01' });
  });

  // The upload already succeeded by this point, so swallowing this error would leave an
  // orphaned object in storage with no row pointing at it.
  it('a failed upsert rethrows rather than orphaning the uploaded object', async () => {
    const fake = makeFakeClient({ 'post_media.upsert': [{ error: DB_DOWN }] });
    await expect(replacePostMedia(asClient(fake), POST, [row()])).rejects.toMatchObject({
      code: '57P01',
    });
    // And it does not go on to sweep: the delete would then be the only statement that landed,
    // stripping the media off a post whose new rows never arrived.
    expect(fake.calls.map((c) => c.op)).toEqual(['upsert']);
  });

  it('a failed sweep rethrows, so the caller is never told a stale set was replaced', async () => {
    const fake = makeFakeClient({
      'post_media.upsert': [{ data: [BASE_MEDIA] }],
      'post_media.delete': [{ error: DB_DOWN }],
    });
    await expect(replacePostMedia(asClient(fake), POST, [row()])).rejects.toMatchObject({
      code: '57P01',
    });
  });

  // Both pin a `?? []` guard against a state that cannot actually occur: a zero-match select
  // returns [], and a returning upsert of one row cannot come back with none. They are here so
  // that deleting the guard fails rather than passes — NOT as a model of PostgREST behaviour.
  it('the read and the write both hold their empty-payload guard', async () => {
    const read = makeFakeClient({ 'post_media.select': [{ data: null }] });
    await expect(getPostMedia(asClient(read), POST)).resolves.toEqual([]);
    const write = makeFakeClient({ 'post_media.upsert': [{ data: null }] });
    await expect(replacePostMedia(asClient(write), POST, [row()])).resolves.toEqual([]);
  });
});
