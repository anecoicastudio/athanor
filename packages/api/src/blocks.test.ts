import { describe, expect, it } from 'vitest';
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

const blockRow = (over: Record<string, unknown> = {}) => ({
  id: BLOCK_ID,
  blocked_id: PEER,
  created_at: '2026-01-02T10:00:00.000Z',
  blocked: { handle: 'peer' },
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
  it('paginates by keyset, never by offset (rule #9)', async () => {
    const client = makeFakeClient();

    await listBlocked(as(client), { createdAt: '2026-01-02T10:00:00.000Z', id: BLOCK_ID });

    const call = client.calls[0];
    expect(call?.filters).toContainEqual([
      'or',
      `created_at.lt.2026-01-02T10:00:00.000Z,and(created_at.eq.2026-01-02T10:00:00.000Z,id.lt.${BLOCK_ID})`,
    ]);
    expect(ops(call?.modifiers ?? [])).not.toContain('range');
    expect(call?.modifiers).toContainEqual(['order', 'created_at', { ascending: false }]);
    expect(call?.modifiers).toContainEqual(['order', 'id', { ascending: false }]);
    expect(ops(call?.modifiers ?? [])).toContain('limit');
  });

  it('lists the people the caller blocked, never the people who blocked the caller', async () => {
    const client = makeFakeClient({ 'blocks.select': [{ data: [blockRow()] }] });

    const items = await listBlocked(as(client));

    expect(items).toEqual([
      { id: BLOCK_ID, peerId: PEER, peerHandle: 'peer', createdAt: '2026-01-02T10:00:00.000Z' },
    ]);
    expect(client.calls[0]?.columns).toContain('blocked_id');
    expect(client.calls[0]?.columns).not.toContain('blocker_id');
  });

  it('surfaces a database error', async () => {
    const client = makeFakeClient({ 'blocks.select': [{ error: { message: 'boom' } }] });

    await expect(listBlocked(as(client))).rejects.toThrow(/boom/);
  });
});
