import { describe, expect, it } from 'vitest';
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
import { makeFakeClient, type FakeResult } from './test-support/fake-client';

const ME = '00000000-0000-4000-8000-000000000001';
const PEER = '00000000-0000-4000-8000-000000000002';
const R1 = '00000000-0000-4000-8000-0000000000b1';
const R2 = '00000000-0000-4000-8000-0000000000b2';
const C1 = '00000000-0000-4000-8000-0000000000c1';

/**
 * One client double for the whole file. The hand-rolled stub this replaces resolved
 * `error: null` unconditionally and had no `rpc` member, so it could not express a database
 * failure — which is precisely why every `if (error) throw error` in this module went untested.
 * It also returned `rows[0] ?? null` from `maybeSingle()`, the semantics
 * `test-support/fake-client.ts` documents as the defect it exists to remove.
 */
const fakeAs = (userId: string | null, script: Record<string, FakeResult[]> = {}) =>
  makeFakeClient({
    // getUser is read once per call, but scripting a few keeps FIFO from falling through to
    // the fake's default identity if a reader ever asks twice.
    'auth.getUser': Array.from({ length: 3 }, () => ({
      data: { user: userId === null ? null : { id: userId } },
    })),
    ...script,
  });

const asClient = (fake: ReturnType<typeof makeFakeClient>) => fake as unknown as AthanorClient;

const REQ_ROW = {
  id: R1,
  requester_id: PEER,
  created_at: '2026-07-02T00:00:00Z',
  requester: { handle: 'mara', display_name: 'Mara Verdi', avatar_path: 'm/m.jpg' },
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
  it('unauthenticated → empty page without querying anything', async () => {
    const fake = fakeAs(null);
    const page = await getIncomingRequestsPage(asClient(fake));
    expect(page).toEqual({ items: [], nextCursor: null });
    expect(fake.calls).toEqual([]);
  });

  it('maps the embedded requester handle, null when the join row is absent', async () => {
    const fake = fakeAs(ME, {
      'connection_requests.select': [
        {
          data: [
            REQ_ROW,
            { id: R2, requester_id: PEER, created_at: '2026-07-01T00:00:00Z', requester: null },
          ],
        },
      ],
    });
    const page = await getIncomingRequestsPage(asClient(fake));
    expect(page.items[0]).toEqual({
      id: R1,
      peerId: PEER,
      peerHandle: 'mara',
      peerDisplayName: 'Mara Verdi',
      peerAvatarPath: 'm/m.jpg',
      createdAt: '2026-07-02T00:00:00Z',
    });
    expect(page.items[1]!.peerHandle).toBeNull();
  });

  it('filters to my pending inbox, orders by (created_at, id) desc', async () => {
    const fake = fakeAs(ME, { 'connection_requests.select': [{ data: [] }] });
    await getIncomingRequestsPage(asClient(fake));
    const call = fake.calls[0]!;
    expect(call.filters).toContainEqual(['eq', 'addressee_id', ME]);
    expect(call.filters).toContainEqual(['eq', 'status', 'pending']);
    expect(call.modifiers.filter((m) => m[0] === 'order').map((m) => m[1])).toEqual([
      'created_at',
      'id',
    ]);
  });

  it('applies the or-cursor and round-trips nextCursor from a full page (rule #9)', async () => {
    const fake = fakeAs(ME, {
      'connection_requests.select': [
        {
          data: [
            REQ_ROW,
            { id: R2, requester_id: PEER, created_at: '2026-07-01T00:00:00Z', requester: null },
          ],
        },
      ],
    });
    const cursor = { created_at: '2026-07-03T00:00:00Z', id: C1 };
    const page = await getIncomingRequestsPage(asClient(fake), { cursor, limit: 2 });
    const or = String(fake.calls[0]!.filters.find((f) => f[0] === 'or')?.[1]);
    expect(or).toContain(`created_at.lt.${cursor.created_at}`);
    expect(or).toContain(`id.lt.${cursor.id}`);
    expect(fake.calls[0]!.modifiers.map((m) => m[0])).not.toContain('range');
    // Full page (2 rows, limit=2) → nextCursor is the last mapped item's keyset
    expect(page.nextCursor).toEqual({ created_at: '2026-07-01T00:00:00Z', id: R2 });
  });

  it('short page → nextCursor null', async () => {
    const fake = fakeAs(ME, { 'connection_requests.select': [{ data: [REQ_ROW] }] });
    const page = await getIncomingRequestsPage(asClient(fake), { limit: 2 });
    expect(page.nextCursor).toBeNull();
  });

  it('a null payload is an empty page, not a crash', async () => {
    const fake = fakeAs(ME, { 'connection_requests.select': [{ data: null }] });
    await expect(getIncomingRequestsPage(asClient(fake))).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('surfaces a database error instead of an empty inbox', async () => {
    // Swallowing an RLS denial renders it as "nobody wants to connect with you", and
    // TanStack Query caches that as a valid result rather than retrying.
    const fake = fakeAs(ME, {
      'connection_requests.select': [{ error: { code: '42501', message: 'permission denied' } }],
    });
    await expect(getIncomingRequestsPage(asClient(fake))).rejects.toMatchObject({ code: '42501' });
  });
});

describe('getConnectionsPage', () => {
  const RPC_ROW = {
    connection_id: C1,
    peer_id: PEER,
    peer_handle: 'mara',
    peer_display_name: 'Mara Verdi',
    peer_avatar_path: 'm/m.jpg',
    created_at: '2026-07-01T00:00:00Z',
  };

  it('calls search_connections with p_query defaulted and NO cursor keys when absent', async () => {
    const fake = makeFakeClient({ 'rpc.search_connections': [{ data: [RPC_ROW] }] });
    const page = await getConnectionsPage(asClient(fake));
    const call = fake.calls[0]!;
    expect(call.columns).toBe('search_connections');
    expect(call.values).toEqual({ p_query: '', p_limit: 20 });
    expect(page.items[0]).toEqual({
      id: C1,
      peerId: PEER,
      peerHandle: 'mara',
      peerDisplayName: 'Mara Verdi',
      peerAvatarPath: 'm/m.jpg',
      createdAt: '2026-07-01T00:00:00Z',
    });
  });

  it('spreads the cursor into p_cursor_* only when present', async () => {
    const fake = makeFakeClient({ 'rpc.search_connections': [{ data: [] }] });
    await getConnectionsPage(asClient(fake), {
      search: 'ma',
      cursor: { created_at: '2026-07-01T00:00:00Z', id: C1 },
      limit: 5,
    });
    expect(fake.calls[0]!.values).toEqual({
      p_query: 'ma',
      p_limit: 5,
      p_cursor_created_at: '2026-07-01T00:00:00Z',
      p_cursor_id: C1,
    });
  });

  it('full page → nextCursor from the last item; short page → null', async () => {
    const second = { ...RPC_ROW, connection_id: R2, created_at: '2026-06-30T00:00:00Z' };
    const full = makeFakeClient({ 'rpc.search_connections': [{ data: [RPC_ROW, second] }] });
    expect((await getConnectionsPage(asClient(full), { limit: 2 })).nextCursor).toEqual({
      created_at: '2026-06-30T00:00:00Z',
      id: R2,
    });
    const short = makeFakeClient({ 'rpc.search_connections': [{ data: [RPC_ROW, second] }] });
    expect((await getConnectionsPage(asClient(short), { limit: 20 })).nextCursor).toBeNull();
  });

  it('a null payload is an empty page, not a crash', async () => {
    const fake = makeFakeClient({ 'rpc.search_connections': [{ data: null }] });
    await expect(getConnectionsPage(asClient(fake))).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('surfaces a database error instead of an empty list', async () => {
    const fake = makeFakeClient({ 'rpc.search_connections': [{ error: { code: '42501' } }] });
    await expect(getConnectionsPage(asClient(fake))).rejects.toMatchObject({ code: '42501' });
  });
});

describe('getConnectionStatus', () => {
  it('unauthenticated → none without querying anything', async () => {
    const fake = fakeAs(null);
    expect(await getConnectionStatus(asClient(fake), PEER)).toEqual({
      state: 'none',
      requestId: null,
    });
    expect(fake.calls).toEqual([]);
  });

  it('queries connections on the canonical (min,max) pair regardless of caller side', async () => {
    // ME < PEER lexicographically; caller is the HIGHER id → still (profile_a=ME, profile_b=PEER)
    const fake = fakeAs(PEER, {
      'connections.select': [{ data: [] }],
      'connection_requests.select': [{ data: [] }],
    });
    await getConnectionStatus(asClient(fake), ME);
    const call = fake.calls.find((c) => c.table === 'connections')!;
    expect(call.filters).toContainEqual(['eq', 'profile_a', ME]);
    expect(call.filters).toContainEqual(['eq', 'profile_b', PEER]);
  });

  it('connected when a connections row exists, without looking at requests', async () => {
    const fake = fakeAs(ME, { 'connections.select': [{ data: [{ id: C1 }] }] });
    expect(await getConnectionStatus(asClient(fake), PEER)).toEqual({
      state: 'connected',
      requestId: null,
    });
    expect(fake.calls.some((c) => c.table === 'connection_requests')).toBe(false);
  });

  it('pending-out when the visible request was sent by me', async () => {
    const fake = fakeAs(ME, {
      'connections.select': [{ data: [] }],
      'connection_requests.select': [{ data: [{ id: R1, requester_id: ME, addressee_id: PEER }] }],
    });
    expect(await getConnectionStatus(asClient(fake), PEER)).toEqual({
      state: 'pending-out',
      requestId: R1,
    });
  });

  it('pending-in when the visible request was sent by the peer', async () => {
    const fake = fakeAs(ME, {
      'connections.select': [{ data: [] }],
      'connection_requests.select': [{ data: [{ id: R1, requester_id: PEER, addressee_id: ME }] }],
    });
    expect(await getConnectionStatus(asClient(fake), PEER)).toEqual({
      state: 'pending-in',
      requestId: R1,
    });
  });

  it('none when neither a connection nor a request exists', async () => {
    const fake = fakeAs(ME, {
      'connections.select': [{ data: [] }],
      'connection_requests.select': [{ data: null }],
    });
    expect(await getConnectionStatus(asClient(fake), PEER)).toEqual({
      state: 'none',
      requestId: null,
    });
  });

  it('throws when the connections read fails', async () => {
    // Degrading to 'none' would show «Connetti» to someone already connected, and the insert
    // would then hit the unique index.
    const fake = fakeAs(ME, { 'connections.select': [{ error: { code: '42501' } }] });
    await expect(getConnectionStatus(asClient(fake), PEER)).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('throws when the pending-request read fails', async () => {
    const fake = fakeAs(ME, {
      'connections.select': [{ data: [] }],
      'connection_requests.select': [{ error: { code: '42501' } }],
    });
    await expect(getConnectionStatus(asClient(fake), PEER)).rejects.toMatchObject({
      code: '42501',
    });
  });
});

describe('mutations', () => {
  it('sendConnection throws when unauthenticated', async () => {
    const fake = fakeAs(null);
    await expect(sendConnection(asClient(fake), PEER)).rejects.toThrow('not authenticated');
  });

  it('sendConnection inserts requester → addressee', async () => {
    const fake = fakeAs(ME, { 'connection_requests.insert': [{}] });
    await sendConnection(asClient(fake), PEER);
    const insert = fake.calls.find((c) => c.op === 'insert')!;
    expect(insert.table).toBe('connection_requests');
    expect(insert.values).toEqual({ requester_id: ME, addressee_id: PEER });
  });

  it('cancelConnection deletes the request scoped by id', async () => {
    const fake = fakeAs(ME, { 'connection_requests.delete': [{}] });
    await cancelConnection(asClient(fake), R1);
    const del = fake.calls.find((c) => c.op === 'delete')!;
    expect(del.table).toBe('connection_requests');
    expect(del.filters).toContainEqual(['eq', 'id', R1]);
  });

  it('respondToConnection goes through the respond_to_connection rpc', async () => {
    const fake = makeFakeClient({ 'rpc.respond_to_connection': [{}] });
    await respondToConnection(asClient(fake), R1, true);
    expect(fake.calls[0]!.columns).toBe('respond_to_connection');
    expect(fake.calls[0]!.values).toEqual({ p_request_id: R1, p_accept: true });
  });

  it('sendConnection throws rather than reporting a request that was never stored', async () => {
    const fake = fakeAs(ME, { 'connection_requests.insert': [{ error: { code: '42501' } }] });
    await expect(sendConnection(asClient(fake), PEER)).rejects.toMatchObject({ code: '42501' });
  });

  it('cancelConnection throws rather than reporting a withdrawal that did not happen', async () => {
    const fake = fakeAs(ME, { 'connection_requests.delete': [{ error: { code: '42501' } }] });
    await expect(cancelConnection(asClient(fake), R1)).rejects.toMatchObject({ code: '42501' });
  });

  it('respondToConnection throws rather than silently dropping an accept', async () => {
    const fake = makeFakeClient({ 'rpc.respond_to_connection': [{ error: { code: '42501' } }] });
    await expect(respondToConnection(asClient(fake), R1, true)).rejects.toMatchObject({
      code: '42501',
    });
  });
});

describe('subscribeIncomingConnections', () => {
  it('returns a cleanup fn that removes the channel it created (rule api.md)', () => {
    const fake = makeFakeClient();
    const cleanup = subscribeIncomingConnections(asClient(fake), () => {});
    expect(typeof cleanup).toBe('function');
    expect(fake.channels).toHaveLength(1);
    expect(fake.channels[0]!.subscribed).toBe(true);
    expect(fake.channels[0]!.removed).toBe(false);
    cleanup();
    // removeChannel throws if handed a channel this client never created, so this also
    // asserts the cleanup removes the RIGHT channel rather than merely calling the method.
    expect(fake.channels[0]!.removed).toBe(true);
  });
});
