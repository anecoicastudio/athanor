import { describe, expect, it, vi } from 'vitest';
import type { AthanorClient } from './client';
import { addComment, getCommentsPage, softDeleteComment, subscribeComments } from './post-comments';

const AUTHOR = '00000000-0000-0000-0000-000000000001';
const POST = '00000000-0000-0000-0000-0000000000b1';
const C1 = '00000000-0000-0000-0000-0000000000c1';
const C2 = '00000000-0000-0000-0000-0000000000c2';

/** Valid `postCommentSchema` row (readers zod-parse every row). */
const BASE_COMMENT = {
  id: C1,
  post_id: POST,
  author_id: AUTHOR,
  parent_id: null,
  body: 'Bel passo.',
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
  chain['single'] = () => {
    calls.push({ method: 'single', arg: undefined });
    return {
      then: (resolve: (v: { data: unknown; error: null }) => void) =>
        resolve({ data: rows[0] ?? null, error: null }),
    };
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

describe('getCommentsPage', () => {
  it('scopes to the post and excludes deleted rows', async () => {
    const { client, calls } = stub([]);
    await getCommentsPage(client, { postId: POST });
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'post_id' && c.arg2 === POST)).toBe(
      true,
    );
    expect(calls.some((c) => c.method === 'is' && c.arg === 'deleted_at' && c.arg2 === null)).toBe(
      true,
    );
  });

  it('orders by (created_at desc, id desc) keyset — never offset', async () => {
    const { client, calls } = stub([]);
    await getCommentsPage(client, { postId: POST });
    const orders = calls.filter((c) => c.method === 'order').map((c) => c.arg);
    expect(orders).toEqual(['created_at', 'id']);
  });

  it('applies the keyset or-disjunction when a cursor is provided', async () => {
    const cursor = { created_at: '2026-01-01T00:00:00Z', id: C1 };
    const { client, calls } = stub([]);
    await getCommentsPage(client, { postId: POST, cursor });
    const orCall = calls.find((c) => c.method === 'or');
    expect(orCall?.arg).toBe(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  });

  it('full page → nextCursor from the last row; rows parsed by postCommentSchema', async () => {
    const rows = [
      { ...BASE_COMMENT, id: C1, created_at: '2026-01-02T00:00:00Z' },
      { ...BASE_COMMENT, id: C2, created_at: '2026-01-01T00:00:00Z' },
    ];
    const { client } = stub(rows);
    const page = await getCommentsPage(client, { postId: POST, limit: 2 });
    expect(page.nextCursor).toEqual({ created_at: '2026-01-01T00:00:00Z', id: C2 });
    expect(page.comments).toHaveLength(2);
    expect(page.comments[0]).toEqual(rows[0]);
  });

  it('short page → nextCursor null', async () => {
    const { client } = stub([{ ...BASE_COMMENT }]); // default limit 20, 1 row
    const page = await getCommentsPage(client, { postId: POST });
    expect(page.nextCursor).toBeNull();
    expect(page.comments).toHaveLength(1);
  });
});

describe('addComment', () => {
  it('rejects an invalid insert via zod BEFORE any db call', async () => {
    const { client, calls } = stub();
    await expect(
      addComment(client, { post_id: POST, author_id: AUTHOR, body: '   ' } as never),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0); // stub untouched — not even from()
  });

  it('inserts the parsed payload then select→single→parse', async () => {
    const { client, calls } = stub([{ ...BASE_COMMENT }]);
    const comment = await addComment(client, {
      post_id: POST,
      author_id: AUTHOR,
      body: '  Bel passo.  ',
    } as never);
    const insert = calls.find((c) => c.method === 'insert');
    expect(insert?.arg).toEqual({
      post_id: POST,
      author_id: AUTHOR,
      body: 'Bel passo.',
      parent_id: null, // insert-schema default
    });
    expect(calls.map((c) => c.method)).toEqual(['from', 'insert', 'select', 'single']);
    expect(comment).toEqual(BASE_COMMENT);
  });
});

describe('softDeleteComment', () => {
  it('sets deleted_at and scopes to (id, not already deleted)', async () => {
    const { client, calls } = stub();
    await softDeleteComment(client, C1);
    const update = calls.find((c) => c.method === 'update');
    expect(update?.arg).toHaveProperty('deleted_at');
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'id' && c.arg2 === C1)).toBe(true);
    expect(calls.some((c) => c.method === 'is' && c.arg === 'deleted_at' && c.arg2 === null)).toBe(
      true,
    );
  });
});

describe('subscribeComments', () => {
  it('subscribes with a post_id=eq.<id> server-side filter', () => {
    const rt = realtimeStub();
    subscribeComments(rt.client, POST, () => {});
    const config = rt.getOnConfig() as { event: string; table: string; filter: string };
    expect(config.event).toBe('INSERT');
    expect(config.table).toBe('post_comments');
    expect(config.filter).toBe(`post_id=eq.${POST}`);
  });

  it('drops malformed payloads; forwards valid ones parsed', () => {
    const rt = realtimeStub();
    const onInsert = vi.fn();
    subscribeComments(rt.client, POST, onInsert);
    rt.fire({ id: 'nope' });
    expect(onInsert).not.toHaveBeenCalled();
    rt.fire({ ...BASE_COMMENT });
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith(BASE_COMMENT);
  });

  it('cleanup removes the channel (rule api.md)', () => {
    const rt = realtimeStub();
    const cleanup = subscribeComments(rt.client, POST, () => {});
    cleanup();
    expect(rt.getRemoved()).toBe(rt.channel);
  });
});
