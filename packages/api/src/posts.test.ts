import { describe, expect, it, vi } from 'vitest';
import type { AthanorClient } from './client';
import { asClient, DB_DOWN, makeFakeClient } from './test-support/fake-client';
import { createPost, getFeedPage, getPostById, softDeletePost, subscribeNewPosts } from './posts';

const AUTHOR = '00000000-0000-0000-0000-000000000001';
const P1 = '00000000-0000-0000-0000-0000000000b1';
const P2 = '00000000-0000-0000-0000-0000000000b2';

/** Valid `postSchema` row (fixtures must parse — the readers zod-parse every row). */
const BASE_POST = {
  id: P1,
  author_id: AUTHOR,
  category: 'business' as const,
  type: 'text' as const,
  body: 'Primo passo del progetto.',
  is_step: false,
  tags: [],
  created_at: '2026-01-02T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  deleted_at: null,
};

/** Thenable PostgREST-builder stub: records calls; awaiting resolves to { data, error }. */
function stub(rows: Array<Record<string, unknown>> = []) {
  const calls: Array<{ method: string; arg: unknown; arg2?: unknown }> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'order', 'limit', 'or']) {
    chain[m] = (arg?: unknown, arg2?: unknown) => {
      calls.push({ method: m, arg, arg2 });
      return chain;
    };
  }
  chain['eq'] = (col: unknown, val?: unknown) => {
    calls.push({ method: 'eq', arg: col, arg2: val });
    return chain;
  };
  chain['is'] = (col: unknown, val?: unknown) => {
    calls.push({ method: 'is', arg: col, arg2: val });
    return chain;
  };
  // single()/maybeSingle() return the first row as data (or null), matching PostgREST
  for (const m of ['single', 'maybeSingle']) {
    chain[m] = () => {
      calls.push({ method: m, arg: undefined });
      return {
        then: (resolve: (v: { data: unknown; error: null }) => void) =>
          resolve({ data: rows[0] ?? null, error: null }),
      };
    };
  }
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

/** Realtime channel stub: captures the postgres_changes config + handler. */
function realtimeStub() {
  let handler: ((payload: { new: unknown }) => void) | undefined;
  let onConfig: unknown;
  let removed: unknown = null;
  const channel = {
    on: (_event: string, config: unknown, cb: (payload: { new: unknown }) => void) => {
      onConfig = config;
      handler = cb;
      return channel;
    },
    subscribe: () => channel,
  };
  const client = {
    channel: () => channel,
    removeChannel: (c: unknown) => {
      removed = c;
    },
  } as unknown as AthanorClient;
  return {
    client,
    channel,
    fire: (row: unknown) => handler?.({ new: row }),
    getOnConfig: () => onConfig,
    getRemoved: () => removed,
  };
}

describe('getFeedPage', () => {
  it("category 'all' adds no category filter", async () => {
    const { client, calls } = stub([]);
    await getFeedPage(client, { category: 'all' });
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'category')).toBe(false);
  });

  it('a specific category filters with eq(category)', async () => {
    const { client, calls } = stub([]);
    await getFeedPage(client, { category: 'business' });
    expect(
      calls.some((c) => c.method === 'eq' && c.arg === 'category' && c.arg2 === 'business'),
    ).toBe(true);
  });

  it('orders by (created_at desc, id desc) and excludes deleted rows', async () => {
    const { client, calls } = stub([]);
    await getFeedPage(client, { category: 'all' });
    const orders = calls.filter((c) => c.method === 'order').map((c) => c.arg);
    expect(orders).toEqual(['created_at', 'id']);
    expect(calls.some((c) => c.method === 'is' && c.arg === 'deleted_at' && c.arg2 === null)).toBe(
      true,
    );
  });

  it('applies the keyset or-disjunction when a cursor is provided — never offset', async () => {
    const cursor = { created_at: '2026-01-01T00:00:00Z', id: P1 };
    const { client, calls } = stub([]);
    await getFeedPage(client, { category: 'all', cursor });
    const orCall = calls.find((c) => c.method === 'or');
    expect(orCall).toBeDefined();
    expect(orCall?.arg).toBe(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  });

  it('returns nextCursor from the last row when a full page comes back', async () => {
    const rows = [
      { ...BASE_POST, id: P1, created_at: '2026-01-02T00:00:00Z' },
      { ...BASE_POST, id: P2, created_at: '2026-01-01T00:00:00Z' },
    ];
    const { client } = stub(rows);
    const page = await getFeedPage(client, { category: 'all', limit: 2 });
    expect(page.nextCursor).toEqual({ created_at: '2026-01-01T00:00:00Z', id: P2 });
    expect(page.posts).toHaveLength(2);
  });

  it('returns nextCursor = null on a short page', async () => {
    const { client } = stub([{ ...BASE_POST }]);
    const page = await getFeedPage(client, { category: 'all' }); // default limit 20, 1 row
    expect(page.nextCursor).toBeNull();
    expect(page.posts).toHaveLength(1);
  });

  it('parses every row through postSchema', async () => {
    const { client } = stub([{ ...BASE_POST, extraneous: 'stripped' }]);
    const page = await getFeedPage(client, { category: 'all' });
    expect(page.posts[0]).toEqual(BASE_POST);
    expect(page.posts[0]).not.toHaveProperty('extraneous');
  });
});

describe('getPostById', () => {
  it('returns null when maybeSingle finds nothing (missing or soft-deleted)', async () => {
    const { client, calls } = stub([]);
    const post = await getPostById(client, P1);
    expect(post).toBeNull();
    expect(calls.some((c) => c.method === 'maybeSingle')).toBe(true);
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'id' && c.arg2 === P1)).toBe(true);
  });

  it('parses the found row', async () => {
    const { client } = stub([{ ...BASE_POST }]);
    const post = await getPostById(client, P1);
    expect(post).toEqual(BASE_POST);
  });
});

describe('createPost', () => {
  it('rejects an invalid insert via zod BEFORE any db call', async () => {
    const { client, calls } = stub();
    await expect(
      createPost(client, { author_id: AUTHOR, category: 'business', body: '   ' } as never),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0); // stub untouched — not even from()
  });

  it('inserts the parsed payload then select→single→parse', async () => {
    const { client, calls } = stub([{ ...BASE_POST }]);
    const post = await createPost(client, {
      author_id: AUTHOR,
      category: 'business',
      body: '  Primo passo del progetto.  ',
    } as never);
    const insert = calls.find((c) => c.method === 'insert');
    // insert schema defaults applied + body trimmed
    expect(insert?.arg).toEqual({
      author_id: AUTHOR,
      category: 'business',
      type: 'text',
      body: 'Primo passo del progetto.',
      is_step: false,
      tags: [],
    });
    expect(calls.map((c) => c.method)).toEqual(['from', 'insert', 'select', 'single']);
    expect(post).toEqual(BASE_POST);
  });
});

describe('softDeletePost', () => {
  it('sets deleted_at and scopes to (id, not already deleted)', async () => {
    const { client, calls } = stub();
    await softDeletePost(client, P1);
    const update = calls.find((c) => c.method === 'update');
    expect(update?.arg).toHaveProperty('deleted_at');
    expect((update?.arg as { deleted_at: string }).deleted_at).toEqual(expect.any(String));
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'id' && c.arg2 === P1)).toBe(true);
    expect(calls.some((c) => c.method === 'is' && c.arg === 'deleted_at' && c.arg2 === null)).toBe(
      true,
    );
  });
});

describe('subscribeNewPosts', () => {
  it('drops malformed payloads at the safeParse gate', () => {
    const rt = realtimeStub();
    const onInsert = vi.fn();
    subscribeNewPosts(rt.client, onInsert);
    rt.fire({ id: 'not-a-post' });
    expect(onInsert).not.toHaveBeenCalled();
  });

  it('forwards valid payloads parsed through postSchema', () => {
    const rt = realtimeStub();
    const onInsert = vi.fn();
    subscribeNewPosts(rt.client, onInsert);
    rt.fire({ ...BASE_POST });
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith(BASE_POST);
    const config = rt.getOnConfig() as { event: string; table: string };
    expect(config.event).toBe('INSERT');
    expect(config.table).toBe('posts');
  });

  it('cleanup removes the channel (rule api.md)', () => {
    const rt = realtimeStub();
    const cleanup = subscribeNewPosts(rt.client, () => {});
    expect(typeof cleanup).toBe('function');
    cleanup();
    expect(rt.getRemoved()).toBe(rt.channel);
  });
});

describe('posts — a database failure reaches the caller', () => {
  // An empty feed and an unreachable database look identical to the reader. The feed is the
  // first thing after launch, so "il flusso è vuoto" on a network blip is the whole app
  // appearing dead.
  it('getFeedPage rethrows instead of rendering an empty feed', async () => {
    const fake = makeFakeClient({ 'posts.select': [{ error: DB_DOWN }] });
    await expect(getFeedPage(asClient(fake), { category: 'all' })).rejects.toMatchObject({
      code: '57P01',
    });
  });

  it('getPostById rethrows instead of reporting the post deleted', async () => {
    const fake = makeFakeClient({ 'posts.select': [{ error: DB_DOWN }] });
    await expect(getPostById(asClient(fake), P1)).rejects.toMatchObject({ code: '57P01' });
  });

  it('createPost rethrows so the composer keeps the draft', async () => {
    const fake = makeFakeClient({ 'posts.insert': [{ error: DB_DOWN }] });
    await expect(
      createPost(asClient(fake), {
        author_id: AUTHOR,
        category: 'evolution',
        body: 'primo passo',
        type: 'text',
        is_step: false,
        tags: [],
      }),
    ).rejects.toMatchObject({ code: '57P01' });
  });

  it('softDeletePost rethrows rather than reporting a silent success', async () => {
    const fake = makeFakeClient({ 'posts.update': [{ error: DB_DOWN }] });
    await expect(softDeletePost(asClient(fake), P1)).rejects.toMatchObject({ code: '57P01' });
  });

  it('getFeedPage treats a null payload as an empty feed, not a crash', async () => {
    const fake = makeFakeClient({ 'posts.select': [{ data: null }] });
    await expect(getFeedPage(asClient(fake), { category: 'all' })).resolves.toEqual({
      posts: [],
      nextCursor: null,
    });
  });
});
