import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  blockKeys,
  blockUser,
  getBlockStatus,
  getBlockedCount,
  listBlocked,
  unblockUser,
} from './blocks';
import type { AthanorClient } from './client';
import { type FakeClient, makeFakeClient } from './test-support/fake-client';

const PEER = '11111111-1111-4111-8111-111111111111';
const BLOCK_ID = '22222222-2222-4222-8222-222222222222';

const as = (c: FakeClient) => c as unknown as AthanorClient;

/** One row of the `list_blocked` RPC — the DEFINER channel, not a profiles embed (#663). */
const blockRow = (over: Record<string, unknown> = {}) => ({
  id: BLOCK_ID,
  blocked_id: PEER,
  created_at: '2026-01-02T10:00:00.000Z',
  handle: 'peer',
  display_name: 'Peer Uno',
  avatar_path: 'p/p.jpg',
  removed: false,
  ...over,
});

const ops = (mods: unknown[][]) => mods.map((m) => m[0]);

describe('blockKeys', () => {
  it('namespaces under blocks and derives stable sub-keys', () => {
    expect(blockKeys.all).toEqual(['blocks']);
    expect(blockKeys.list()).toEqual(['blocks', 'list']);
    expect(blockKeys.count()).toEqual(['blocks', 'count']);
    expect(blockKeys.status('p1')).toEqual(['blocks', 'status', 'p1']);
  });
});

describe('blockUser', () => {
  it('rejects a non-uuid target before touching the database', async () => {
    const client = makeFakeClient();

    await expect(blockUser(as(client), 'not-a-uuid')).rejects.toThrow();
    expect(client.calls).toEqual([]);
  });

  it('sends only the target — blocker_id is the server default, never a client field', async () => {
    const client = makeFakeClient({
      'blocks.insert': [
        { data: [{ id: BLOCK_ID, blocker_id: PEER, blocked_id: PEER, created_at: 'now' }] },
      ],
    });

    await blockUser(as(client), PEER);

    expect(client.calls[0]?.table).toBe('blocks');
    expect(client.calls[0]?.op).toBe('insert');
    expect(client.calls[0]?.values).toEqual({ blocked_id: PEER });
    expect(Object.keys(client.calls[0]?.values as object)).not.toContain('blocker_id');
  });

  it('surfaces an insert error rather than reporting a block that never landed', async () => {
    const client = makeFakeClient({
      'blocks.insert': [{ error: { message: 'duplicate key value' } }],
    });

    await expect(blockUser(as(client), PEER)).rejects.toThrow(/duplicate key/);
  });
});

describe('unblockUser', () => {
  it('hard-deletes the caller-owned row for that target', async () => {
    const client = makeFakeClient();

    await unblockUser(as(client), PEER);

    expect(client.calls[0]?.op).toBe('delete');
    expect(client.calls[0]?.filters).toContainEqual(['eq', 'blocked_id', PEER]);
  });

  it('surfaces a delete error', async () => {
    const client = makeFakeClient({
      'blocks.delete': [{ error: { message: 'permission denied' } }],
    });

    await expect(unblockUser(as(client), PEER)).rejects.toThrow(/permission denied/);
  });
});

describe('getBlockStatus', () => {
  it('is true when the caller holds a block on that person', async () => {
    const client = makeFakeClient({ 'blocks.select': [{ data: [{ id: BLOCK_ID }] }] });

    await expect(getBlockStatus(as(client), PEER)).resolves.toBe(true);
  });

  it('is false — not an error — when no row exists', async () => {
    // maybeSingle(), not single(): "no block" is a normal answer, and single() would raise
    // PGRST116 on the empty result.
    const client = makeFakeClient({ 'blocks.select': [{ data: [] }] });

    await expect(getBlockStatus(as(client), PEER)).resolves.toBe(false);
    expect(client.calls[0]?.terminal).toBe('maybeSingle');
  });

  it('asks only about the caller-as-blocker direction', async () => {
    // Blocking is symmetric in effect (athanor.not_blocked reads both directions) but the
    // blocks table stays blocker-readable only, so a blocked person can never learn who
    // blocked them. A query reaching for the other direction would be that leak.
    const client = makeFakeClient({ 'blocks.select': [{ data: [] }] });

    await getBlockStatus(as(client), PEER);

    expect(client.calls[0]?.filters).toContainEqual(['eq', 'blocked_id', PEER]);
    expect(client.calls[0]?.filters.flat()).not.toContain('blocker_id');
    expect(ops(client.calls[0]?.filters ?? [])).not.toContain('or');
  });

  it('surfaces a database error', async () => {
    const client = makeFakeClient({ 'blocks.select': [{ error: { message: 'boom' } }] });

    await expect(getBlockStatus(as(client), PEER)).rejects.toThrow(/boom/);
  });
});

describe('getBlockedCount', () => {
  it('counts head-only — the number is for the owner, never a fetched list', async () => {
    const client = makeFakeClient({ 'blocks.select': [{ count: 4 }] });

    await expect(getBlockedCount(as(client))).resolves.toBe(4);
    expect(client.calls[0]?.options).toMatchObject({ count: 'exact', head: true });
  });

  it('reads a missing count as zero', async () => {
    const client = makeFakeClient({ 'blocks.select': [{ count: null }] });

    await expect(getBlockedCount(as(client))).resolves.toBe(0);
  });

  it('surfaces a database error', async () => {
    const client = makeFakeClient({ 'blocks.select': [{ error: { message: 'boom' } }] });

    await expect(getBlockedCount(as(client))).rejects.toThrow(/boom/);
  });
});

describe('listBlocked', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads through the list_blocked RPC, never a blocks → profiles embed (#663)', async () => {
    const client = makeFakeClient({ 'rpc.list_blocked': [{ data: [blockRow()] }] });

    await listBlocked(as(client));

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.op).toBe('rpc');
    expect(client.calls[0]?.columns).toBe('list_blocked');
    expect(client.calls[0]?.table).toBe('rpc');
  });

  it('paginates by keyset through the RPC cursor, never by offset (rule #9)', async () => {
    const client = makeFakeClient({ 'rpc.list_blocked': [{ data: [] }] });

    await listBlocked(as(client), { createdAt: '2026-01-02T10:00:00.000Z', id: BLOCK_ID });

    expect(client.calls[0]?.values).toEqual({
      p_limit: 30,
      p_before_created_at: '2026-01-02T10:00:00.000Z',
      p_before_id: BLOCK_ID,
    });
    expect(ops(client.calls[0]?.modifiers ?? [])).not.toContain('range');
  });

  it('sends no cursor halves on the first page', async () => {
    const client = makeFakeClient({ 'rpc.list_blocked': [{ data: [] }] });

    await listBlocked(as(client));

    expect(client.calls[0]?.values).toEqual({ p_limit: 30 });
  });

  it('lists the people the caller blocked, never naming the caller', async () => {
    const client = makeFakeClient({ 'rpc.list_blocked': [{ data: [blockRow()] }] });

    const { items, excluded } = await listBlocked(as(client));

    expect(items).toEqual([
      {
        id: BLOCK_ID,
        peerId: PEER,
        peerHandle: 'peer',
        peerDisplayName: 'Peer Uno',
        peerAvatarPath: 'p/p.jpg',
        removed: false,
        createdAt: '2026-01-02T10:00:00.000Z',
      },
    ]);
    expect(excluded).toBe(0);
    // The ownership predicate lives in the DEFINER body; the client never sends a blocker id.
    expect(JSON.stringify(client.calls[0]?.values)).not.toContain('blocker');
  });

  it('carries a banned peer through as the #314 tombstone', async () => {
    const client = makeFakeClient({
      'rpc.list_blocked': [
        {
          data: [blockRow({ handle: null, display_name: null, avatar_path: null, removed: true })],
        },
      ],
    });

    const { items } = await listBlocked(as(client));

    expect(items[0]).toMatchObject({
      peerHandle: null,
      peerDisplayName: null,
      peerAvatarPath: null,
      removed: true,
    });
  });

  it('withholds a row the schema no longer recognises instead of taking the list down', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = makeFakeClient({
      'rpc.list_blocked': [{ data: [blockRow(), { id: 'garbage', blocked_id: PEER }] }],
    });

    const { items, excluded } = await listBlocked(as(client));

    expect(items).toHaveLength(1);
    expect(excluded).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('surfaces a database error', async () => {
    const client = makeFakeClient({ 'rpc.list_blocked': [{ error: { message: 'boom' } }] });

    await expect(listBlocked(as(client))).rejects.toThrow(/boom/);
  });
});
