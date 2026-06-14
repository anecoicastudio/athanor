import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import {
  addMilestone,
  listMilestones,
  milestoneKeys,
  softDeleteMilestone,
  updateMilestoneStatus,
} from './milestones';

const DREAM = '00000000-0000-0000-0000-0000000000d1';
const MS = '00000000-0000-0000-0000-0000000000a1';

/** Thenable PostgREST-builder stub: records calls; awaiting resolves to { data, error }. */
function stub(rows: Array<Record<string, unknown>> = []) {
  const calls: Array<{ method: string; arg: unknown; arg2?: unknown }> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'order']) {
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
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
    resolve({ data: rows, error: null });
  const client = { from: () => chain } as unknown as AthanorClient;
  return { client, calls };
}

describe('milestones api', () => {
  it('key factory shape', () => {
    expect(milestoneKeys.list(DREAM)).toEqual(['milestones', 'dream', DREAM]);
  });

  it('addMilestone inserts a trimmed body', async () => {
    const { client, calls } = stub();
    await addMilestone(client, { dream_id: DREAM, body: '  Un mentor  ' });
    const insert = calls.find((c) => c.method === 'insert');
    expect(insert?.arg).toEqual({ dream_id: DREAM, body: 'Un mentor' });
  });

  it('updateMilestoneStatus updates status scoped to the id, skipping deleted', async () => {
    const { client, calls } = stub();
    await updateMilestoneStatus(client, MS, 'done');
    const update = calls.find((c) => c.method === 'update');
    expect(update?.arg).toEqual({ status: 'done' });
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'id' && c.arg2 === MS)).toBe(true);
    expect(calls.some((c) => c.method === 'is' && c.arg === 'deleted_at' && c.arg2 === null)).toBe(
      true,
    );
  });

  it('softDeleteMilestone sets deleted_at and scopes to the id', async () => {
    const { client, calls } = stub();
    await softDeleteMilestone(client, MS);
    const update = calls.find((c) => c.method === 'update');
    expect(update?.arg).toHaveProperty('deleted_at');
    expect((update?.arg as { deleted_at: string }).deleted_at).toEqual(expect.any(String));
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'id' && c.arg2 === MS)).toBe(true);
    expect(calls.some((c) => c.method === 'is' && c.arg === 'deleted_at' && c.arg2 === null)).toBe(
      true,
    );
  });

  it('listMilestones filters non-deleted and orders by the (position, created_at, id) keyset', async () => {
    const row = {
      id: MS,
      dream_id: DREAM,
      body: 'Un mentor',
      status: 'open',
      position: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      deleted_at: null,
    };
    const { client, calls } = stub([row]);
    const result = await listMilestones(client, DREAM);
    expect(result).toEqual([row]);
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'dream_id' && c.arg2 === DREAM)).toBe(
      true,
    );
    expect(calls.some((c) => c.method === 'is' && c.arg === 'deleted_at' && c.arg2 === null)).toBe(
      true,
    );
    expect(calls.filter((c) => c.method === 'order').map((c) => c.arg)).toEqual([
      'position',
      'created_at',
      'id',
    ]);
  });
});
