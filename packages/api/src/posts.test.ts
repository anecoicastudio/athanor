import { describe, expect, it, vi } from 'vitest';
import type { PostMediaPublish } from '@athanor/schemas';
import type { AthanorClient } from './client';
import { asClient, DB_DOWN, makeFakeClient } from './test-support/fake-client';
import { getFeedPage, getPostById, publishPost, softDeletePost, subscribeNewPosts } from './posts';

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
  for (const m of ['select', 'insert', 'upsert', 'update', 'order', 'limit', 'or']) {
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

describe('getFeedPage (light connection boost, #152)', () => {
  const FRIEND = '00000000-0000-0000-0000-00000000000f';
  const F1 = '00000000-0000-0000-0000-0000000000f1';

  const postRow = (id: string, created_at: string, author = AUTHOR) => ({
    ...BASE_POST,
    id,
    author_id: author,
    created_at,
    updated_at: created_at,
  });

  const postSelects = (fake: ReturnType<typeof makeFakeClient>) =>
    fake.calls.filter((c) => c.table === 'posts' && c.op === 'select');

  it('a reader with no connections gets the pure chronological page from one query', async () => {
    const rows = [postRow(P1, '2026-01-02T11:00:00Z'), postRow(P2, '2026-01-02T10:00:00Z')];
    const fake = makeFakeClient({
      'connections.select': [{ data: [] }],
      'posts.select': [{ data: rows }],
    });
    const page = await getFeedPage(asClient(fake), { category: 'all' });
    expect(page.posts.map((p) => p.id)).toEqual([P1, P2]);
    expect(postSelects(fake)).toHaveLength(1); // no boosted stream without peers
    expect(page.nextCursor).toBeNull(); // short page, nothing more
  });

  it('orders by (created_at desc, id desc) and excludes deleted rows — on every stream', async () => {
    const fake = makeFakeClient({
      'connections.select': [{ data: [{ profile_a: 'prof-1', profile_b: FRIEND }] }],
      'posts.select': [{ data: [] }, { data: [] }],
    });
    await getFeedPage(asClient(fake), { category: 'all' });
    const selects = postSelects(fake);
    expect(selects).toHaveLength(2);
    for (const call of selects) {
      expect(call.modifiers).toContainEqual(['order', 'created_at', { ascending: false }]);
      expect(call.modifiers).toContainEqual(['order', 'id', { ascending: false }]);
      expect(call.filters).toContainEqual(['is', 'deleted_at', null]);
      expect(call.modifiers.some(([name]) => name === 'range')).toBe(false); // never offset
    }
  });

  it('applies a specific category to both streams', async () => {
    const fake = makeFakeClient({
      'connections.select': [{ data: [{ profile_a: 'prof-1', profile_b: FRIEND }] }],
      'posts.select': [{ data: [] }, { data: [] }],
    });
    await getFeedPage(asClient(fake), { category: 'business' });
    for (const call of postSelects(fake)) {
      expect(call.filters).toContainEqual(['eq', 'category', 'business']);
    }
  });

  it('restricts the boosted stream to the connection authors', async () => {
    const fake = makeFakeClient({
      'connections.select': [{ data: [{ profile_a: 'prof-1', profile_b: FRIEND }] }],
      'posts.select': [{ data: [] }, { data: [] }],
    });
    await getFeedPage(asClient(fake), { category: 'all' });
    const [chrono, boosted] = postSelects(fake);
    expect(chrono?.filters.some(([name]) => name === 'in')).toBe(false);
    expect(boosted?.filters).toContainEqual(['in', 'author_id', [FRIEND]]);
  });

  it('keeps each stream on its own raw keyset cursor — never offset, no arithmetic', async () => {
    const cursor = {
      chrono: { created_at: '2026-01-01T00:00:00Z', id: P1 },
      conn: { created_at: '2026-01-01T06:00:00Z', id: P2 },
      frontier: { ms: Date.parse('2026-01-01T08:00:00Z'), id: P2 },
      peerIds: [FRIEND],
    };
    const fake = makeFakeClient({ 'posts.select': [{ data: [] }, { data: [] }] });
    await getFeedPage(asClient(fake), { category: 'all', cursor });
    expect(fake.calls.some((c) => c.table === 'connections')).toBe(false); // snapshot reused
    const [chrono, boosted] = postSelects(fake);
    expect(chrono?.filters).toContainEqual([
      'or',
      `created_at.lt.${cursor.chrono.created_at},and(created_at.eq.${cursor.chrono.created_at},id.lt.${P1})`,
    ]);
    expect(boosted?.filters).toContainEqual([
      'or',
      `created_at.lt.${cursor.conn.created_at},and(created_at.eq.${cursor.conn.created_at},id.lt.${P2})`,
    ]);
  });

  it('nudges a connection post above a slightly newer stranger post', async () => {
    const friendPost = postRow(F1, '2026-01-02T10:30:00Z', FRIEND);
    const strangerPost = postRow(P1, '2026-01-02T11:30:00Z');
    const fake = makeFakeClient({
      'connections.select': [{ data: [{ profile_a: 'prof-1', profile_b: FRIEND }] }],
      'posts.select': [{ data: [strangerPost, friendPost] }, { data: [friendPost] }],
    });
    const page = await getFeedPage(asClient(fake), { category: 'all' });
    expect(page.posts.map((p) => p.id)).toEqual([F1, P1]); // boosted 2h → 12:30 beats 11:30
  });

  it('keeps chronology the backbone: a 3-day-old connection post never outranks today', async () => {
    const friendPost = postRow(F1, '2025-12-30T12:00:00Z', FRIEND);
    const strangerPost = postRow(P1, '2026-01-02T06:00:00Z');
    const fake = makeFakeClient({
      'connections.select': [{ data: [{ profile_a: 'prof-1', profile_b: FRIEND }] }],
      'posts.select': [{ data: [strangerPost, friendPost] }, { data: [friendPost] }],
    });
    const page = await getFeedPage(asClient(fake), { category: 'all' });
    expect(page.posts.map((p) => p.id)).toEqual([P1, F1]);
  });

  it('carries the peer snapshot and per-stream cursors through nextCursor', async () => {
    const rows = [postRow(P1, '2026-01-02T11:00:00Z'), postRow(P2, '2026-01-02T10:00:00Z')];
    const fake = makeFakeClient({
      'connections.select': [{ data: [{ profile_a: 'prof-1', profile_b: FRIEND }] }],
      'posts.select': [{ data: rows }, { data: [] }],
    });
    const page = await getFeedPage(asClient(fake), { category: 'all', limit: 2 });
    expect(page.posts).toHaveLength(2);
    expect(page.nextCursor).toEqual({
      chrono: { created_at: '2026-01-02T10:00:00Z', id: P2 },
      conn: null, // boosted stream untouched this page — no cursor to advance
      frontier: { ms: Date.parse('2026-01-02T10:00:00Z'), id: P2 },
      peerIds: [FRIEND],
    });
  });

  it('parses every row through postSchema', async () => {
    const fake = makeFakeClient({
      'connections.select': [{ data: [] }],
      'posts.select': [{ data: [{ ...BASE_POST, extraneous: 'stripped' }] }],
    });
    const page = await getFeedPage(asClient(fake), { category: 'all' });
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

/** Valid `postMediaSchema` row for the RPC's answer. */
const BASE_MEDIA = {
  id: '00000000-0000-0000-0000-0000000000d1',
  post_id: P1,
  kind: 'image' as const,
  storage_path: 'u1/p1/0.jpg',
  thumb_path: null,
  duration_s: null,
  width: 1080,
  height: 1350,
  position: 0,
  created_at: '2026-01-02T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

/** One well-formed media row for the publish payload. */
const mediaRow = (over: Partial<PostMediaPublish> = {}): PostMediaPublish => ({
  kind: 'image',
  storage_path: 'u1/p1/0.jpg',
  position: 0,
  thumb_path: null,
  duration_s: null,
  width: null,
  height: null,
  ...over,
});

describe('publishPost', () => {
  it('rejects an invalid post via zod BEFORE any db call', async () => {
    const fake = makeFakeClient();
    await expect(
      publishPost(asClient(fake), { category: 'business', body: '   ' } as never),
    ).rejects.toThrow();
    expect(fake.calls).toHaveLength(0); // fake untouched — not even rpc()
  });

  it('rejects an invalid media row via zod BEFORE any db call', async () => {
    const fake = makeFakeClient();
    await expect(
      publishPost(asClient(fake), { category: 'business', body: 'ciao', type: 'image' } as never, [
        mediaRow({ position: -1 }),
      ]),
    ).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });

  /**
   * #588: ONE call, and it is the RPC. Two PostgREST writes cannot be one transaction, so a
   * post committed before its media is exactly the orphan card this closes — asserted on the
   * TRANSPORT, because a version that split the write again would satisfy every value
   * assertion below and still publish a text-only card whenever the media half failed.
   */
  it('writes through the publish_post RPC, once, and never touches the tables', async () => {
    const fake = makeFakeClient({
      'rpc.publish_post': [{ data: { post: BASE_POST, media: [] } }],
    });
    await publishPost(asClient(fake), {
      id: P1,
      category: 'business',
      body: 'Primo passo',
      type: 'text',
      is_step: false,
      tags: [],
    });
    expect(fake.calls.map((c) => c.op)).toEqual(['rpc']);
    expect(fake.calls[0]?.columns).toBe('publish_post');
  });

  it('sends the parsed payload — defaults applied, body trimmed, author never on the wire', async () => {
    const fake = makeFakeClient({
      'rpc.publish_post': [{ data: { post: BASE_POST, media: [] } }],
    });
    const result = await publishPost(asClient(fake), {
      id: P1,
      category: 'business',
      body: '  Primo passo del progetto.  ',
      type: 'text',
      is_step: false,
      tags: [],
    });
    expect(fake.calls[0]?.values).toEqual({
      p_id: P1,
      p_category: 'business',
      p_body: 'Primo passo del progetto.',
      p_type: 'text',
      p_is_step: false,
      p_tags: [],
      p_media: [],
    });
    expect(result).toEqual({ post: BASE_POST, media: [] });
  });

  /**
   * The media set is passed WHOLE and the parent is never spelled: `publish_post` assigns
   * `post_id` from the post it is writing, so a row aimed at another post is unrepresentable
   * rather than refused (#588), and an EMPTY set is the sweep the member asked for (#586).
   */
  it('passes the media set whole, with no post_id on any row', async () => {
    const fake = makeFakeClient({
      'rpc.publish_post': [
        { data: { post: { ...BASE_POST, type: 'image' }, media: [BASE_MEDIA] } },
      ],
    });
    const result = await publishPost(
      asClient(fake),
      { id: P1, category: 'business', body: 'Con foto', type: 'image', is_step: false, tags: [] },
      [mediaRow({ position: 0 }), mediaRow({ position: 1, storage_path: 'u1/p1/1.jpg' })],
    );
    const args = fake.calls[0]?.values as { p_media: PostMediaPublish[] };
    expect(args.p_media).toEqual([
      mediaRow({ position: 0 }),
      mediaRow({ position: 1, storage_path: 'u1/p1/1.jpg' }),
    ]);
    expect(args.p_media.some((r) => 'post_id' in r)).toBe(false);
    expect(result.media).toEqual([BASE_MEDIA]);
  });

  /**
   * #579: the client-minted PK is what makes a re-tap converge rather than mint a second post.
   * zod strips an undeclared key, so a dropped `id` fails silently — asserted by value.
   */
  it('carries a client-minted id through as p_id', async () => {
    const fake = makeFakeClient({
      'rpc.publish_post': [{ data: { post: BASE_POST, media: [] } }],
    });
    await publishPost(asClient(fake), {
      id: P1,
      category: 'business',
      body: 'Primo passo',
      type: 'text',
      is_step: false,
      tags: [],
    });
    expect((fake.calls[0]?.values as { p_id?: string }).p_id).toBe(P1);
  });

  // Omitted rather than sent as null: the RPC coalesces a missing p_id to gen_random_uuid(),
  // and an explicit null would be the same thing said less clearly.
  it('omits p_id entirely when the caller mints none', async () => {
    const fake = makeFakeClient({
      'rpc.publish_post': [{ data: { post: BASE_POST, media: [] } }],
    });
    await publishPost(asClient(fake), {
      category: 'business',
      body: 'Primo passo',
      type: 'text',
      is_step: false,
      tags: [],
    });
    expect('p_id' in (fake.calls[0]?.values as object)).toBe(false);
  });

  it('parses the answer rather than trusting it', async () => {
    const fake = makeFakeClient({
      'rpc.publish_post': [{ data: { post: { ...BASE_POST, category: 'spam' }, media: [] } }],
    });
    await expect(
      publishPost(asClient(fake), {
        id: P1,
        category: 'business',
        body: 'Primo passo',
        type: 'text',
        is_step: false,
        tags: [],
      }),
    ).rejects.toThrow();
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

  it('publishPost rethrows so the composer keeps the draft', async () => {
    const fake = makeFakeClient({ 'rpc.publish_post': [{ error: DB_DOWN }] });
    await expect(
      publishPost(asClient(fake), {
        id: P1,
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
