import { describe, expect, it, vi } from 'vitest';
import type { AthanorClient } from './client';
import {
  cancelConnection,
  connectionKeys,
  getConnectionsPage,
  getConnectionStatus,
  getIncomingRequestsPage,
  respondToConnection,
  sendConnection,
  subscribeIncomingConnections,
} from './connections';

const ME = '00000000-0000-4000-8000-000000000001';
const PEER = '00000000-0000-4000-8000-000000000002';
const R1 = '00000000-0000-4000-8000-0000000000b1';
const R2 = '00000000-0000-4000-8000-0000000000b2';
const C1 = '00000000-0000-4000-8000-0000000000c1';

/** Thenable PostgREST-builder stub: records calls; awaiting resolves to { data, error }. */
function stub(
  opts: {
    userId?: string | null;
    tables?: Record<string, Array<Record<string, unknown>>>;
  } = {},
) {
  const calls: Array<{ method: string; arg: unknown; arg2?: unknown }> = [];
  const makeChain = (rows: Array<Record<string, unknown>>) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'insert', 'delete', 'order', 'limit', 'or']) {
      chain[m] = (arg?: unknown, arg2?: unknown) => {
        calls.push({ method: m, arg, arg2 });
        return chain;
      };
    }
    chain['eq'] = (col: unknown, val?: unknown) => {
      calls.push({ method: 'eq', arg: col, arg2: val });
      return chain;
    };
    chain['maybeSingle'] = () => {
      calls.push({ method: 'maybeSingle', arg: undefined });
      return {
        then: (resolve: (v: { data: unknown; error: null }) => void) =>
          resolve({ data: rows[0] ?? null, error: null }),
      };
    };
    chain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
      resolve({ data: rows, error: null });
    return chain;
  };
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: opts.userId === null ? null : { id: opts.userId ?? ME } },
      }),
    },
    from: (table: string) => {
      calls.push({ method: 'from', arg: table });
      return makeChain(opts.tables?.[table] ?? []);
    },
  } as unknown as AthanorClient;
  return { client, calls };
}

const REQ_ROW = {
  id: R1,
  requester_id: PEER,
  created_at: '2026-07-02T00:00:00Z',
  requester: { handle: 'mara' },
};

describe('connectionKeys', () => {
  it('namespaces incoming / list / status under the connections root', () => {
    expect(connectionKeys.all).toEqual(['connections']);
    expect(connectionKeys.incoming()).toEqual(['connections', 'incoming']);
    expect(connectionKeys.list()).toEqual(['connections', 'list', '']);
    expect(connectionKeys.list('ma')).toEqual(['connections', 'list', 'ma']);
    expect(connectionKeys.status(PEER)).toEqual(['connections', 'status', PEER]);
  });
});

describe('getIncomingRequestsPage', () => {
  it('unauthenticated → empty page without touching from()', async () => {
    const { client, calls } = stub({ userId: null });
    const page = await getIncomingRequestsPage(client);
    expect(page).toEqual({ items: [], nextCursor: null });
    expect(calls.some((c) => c.method === 'from')).toBe(false);
  });

  it('maps the embedded requester handle, null when the join row is absent', async () => {
    const rows = [
      REQ_ROW,
      { id: R2, requester_id: PEER, created_at: '2026-07-01T00:00:00Z', requester: null },
    ];
    const { client } = stub({ tables: { connection_requests: rows } });
    const page = await getIncomingRequestsPage(client);
    expect(page.items[0]).toEqual({
      id: R1,
      peerId: PEER,
      peerHandle: 'mara',
      createdAt: '2026-07-02T00:00:00Z',
    });
    expect(page.items[1]!.peerHandle).toBeNull();
  });

  it('filters to my pending inbox, orders by (created_at, id) desc', async () => {
    const { client, calls } = stub({ tables: { connection_requests: [] } });
    await getIncomingRequestsPage(client);
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'addressee_id' && c.arg2 === ME)).toBe(
      true,
    );
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'status' && c.arg2 === 'pending')).toBe(
      true,
    );
    expect(calls.filter((c) => c.method === 'order').map((c) => c.arg)).toEqual([
      'created_at',
      'id',
    ]);
  });

  it('applies the or-cursor and round-trips nextCursor from a full page', async () => {
    const rows = [
      REQ_ROW,
      { id: R2, requester_id: PEER, created_at: '2026-07-01T00:00:00Z', requester: null },
    ];
    const { client, calls } = stub({ tables: { connection_requests: rows } });
    const cursor = { created_at: '2026-07-03T00:00:00Z', id: C1 };
    const page = await getIncomingRequestsPage(client, { cursor, limit: 2 });
    const orCall = calls.find((c) => c.method === 'or');
    expect(orCall?.arg).toContain(`created_at.lt.${cursor.created_at}`);
    expect(orCall?.arg).toContain(`id.lt.${cursor.id}`);
    // Full page (2 rows, limit=2) → nextCursor is the last mapped item's keyset
    expect(page.nextCursor).toEqual({ created_at: '2026-07-01T00:00:00Z', id: R2 });
  });

  it('short page → nextCursor null', async () => {
    const { client } = stub({ tables: { connection_requests: [REQ_ROW] } });
    const page = await getIncomingRequestsPage(client, { limit: 2 });
    expect(page.nextCursor).toBeNull();
  });
});

describe('getConnectionsPage', () => {
  const RPC_ROW = {
    connection_id: C1,
    peer_id: PEER,
    peer_handle: 'mara',
    created_at: '2026-07-01T00:00:00Z',
  };

  it('calls search_connections with p_query defaulted and NO cursor keys when absent', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [RPC_ROW], error: null });
    const page = await getConnectionsPage({ rpc } as unknown as AthanorClient);
    expect(rpc).toHaveBeenCalledWith('search_connections', { p_query: '', p_limit: 20 });
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect('p_cursor_created_at' in args).toBe(false);
    expect('p_cursor_id' in args).toBe(false);
    expect(page.items[0]).toEqual({
      id: C1,
      peerId: PEER,
      peerHandle: 'mara',
      createdAt: '2026-07-01T00:00:00Z',
    });
  });

  it('spreads the cursor into p_cursor_* only when present', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    await getConnectionsPage({ rpc } as unknown as AthanorClient, {
      search: 'ma',
      cursor: { created_at: '2026-07-01T00:00:00Z', id: C1 },
      limit: 5,
    });
    expect(rpc).toHaveBeenCalledWith('search_connections', {
      p_query: 'ma',
      p_limit: 5,
      p_cursor_created_at: '2026-07-01T00:00:00Z',
      p_cursor_id: C1,
    });
  });

  it('full page → nextCursor from the last item; short page → null', async () => {
    const second = { ...RPC_ROW, connection_id: R2, created_at: '2026-06-30T00:00:00Z' };
    const rpc = vi.fn().mockResolvedValue({ data: [RPC_ROW, second], error: null });
    const full = await getConnectionsPage({ rpc } as unknown as AthanorClient, { limit: 2 });
    expect(full.nextCursor).toEqual({ created_at: '2026-06-30T00:00:00Z', id: R2 });
    const short = await getConnectionsPage({ rpc } as unknown as AthanorClient, { limit: 20 });
    expect(short.nextCursor).toBeNull();
  });
});

describe('getConnectionStatus', () => {
  it('unauthenticated → none without touching from()', async () => {
    const { client, calls } = stub({ userId: null });
    expect(await getConnectionStatus(client, PEER)).toEqual({ state: 'none', requestId: null });
    expect(calls.some((c) => c.method === 'from')).toBe(false);
  });

  it('queries connections on the canonical (min,max) pair regardless of caller side', async () => {
    // ME < PEER lexicographically; caller is the HIGHER id → still (profile_a=ME, profile_b=PEER)
    const { client, calls } = stub({ userId: PEER });
    await getConnectionStatus(client, ME);
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'profile_a' && c.arg2 === ME)).toBe(
      true,
    );
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'profile_b' && c.arg2 === PEER)).toBe(
      true,
    );
  });

  it('connected when a connections row exists', async () => {
    const { client } = stub({ tables: { connections: [{ id: C1 }] } });
    expect(await getConnectionStatus(client, PEER)).toEqual({
      state: 'connected',
      requestId: null,
    });
  });

  it('pending-out when the visible request was sent by me', async () => {
    const req = { id: R1, requester_id: ME, addressee_id: PEER };
    const { client } = stub({ tables: { connection_requests: [req] } });
    expect(await getConnectionStatus(client, PEER)).toEqual({
      state: 'pending-out',
      requestId: R1,
    });
  });

  it('pending-in when the visible request was sent by the peer', async () => {
    const req = { id: R1, requester_id: PEER, addressee_id: ME };
    const { client } = stub({ tables: { connection_requests: [req] } });
    expect(await getConnectionStatus(client, PEER)).toEqual({
      state: 'pending-in',
      requestId: R1,
    });
  });

  it('none when neither a connection nor a request exists', async () => {
    const { client } = stub();
    expect(await getConnectionStatus(client, PEER)).toEqual({ state: 'none', requestId: null });
  });
});

describe('mutations', () => {
  it('sendConnection throws when unauthenticated', async () => {
    const { client } = stub({ userId: null });
    await expect(sendConnection(client, PEER)).rejects.toThrow('not authenticated');
  });

  it('sendConnection inserts requester → addressee', async () => {
    const { client, calls } = stub();
    await sendConnection(client, PEER);
    const insert = calls.find((c) => c.method === 'insert');
    expect(insert?.arg).toEqual({ requester_id: ME, addressee_id: PEER });
  });

  it('cancelConnection deletes the request scoped by id', async () => {
    const { client, calls } = stub();
    await cancelConnection(client, R1);
    expect(calls.some((c) => c.method === 'from' && c.arg === 'connection_requests')).toBe(true);
    expect(calls.some((c) => c.method === 'delete')).toBe(true);
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'id' && c.arg2 === R1)).toBe(true);
  });

  it('respondToConnection goes through the respond_to_connection rpc', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await respondToConnection({ rpc } as unknown as AthanorClient, R1, true);
    expect(rpc).toHaveBeenCalledWith('respond_to_connection', {
      p_request_id: R1,
      p_accept: true,
    });
  });
});

describe('subscribeIncomingConnections', () => {
  it('returns a cleanup fn that removes the channel (rule api.md)', () => {
    let removed: unknown = null;
    const channel = { on: () => channel, subscribe: () => channel };
    const fakeClient = {
      channel: () => channel,
      removeChannel: (c: unknown) => {
        removed = c;
      },
    } as unknown as AthanorClient;
    const cleanup = subscribeIncomingConnections(fakeClient, () => {});
    expect(typeof cleanup).toBe('function');
    cleanup();
    expect(removed).toBe(channel);
  });
});
