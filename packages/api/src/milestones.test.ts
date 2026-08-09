import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import { asClient, DB_DOWN, makeFakeClient } from './test-support/fake-client';
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

// The stub above hardcodes `error: null`, so no test here could express a database failure and
// every `if (error) throw error` arm was unreachable. `makeFakeClient` is the shared fake that
// exists to remove exactly that blind spot.

describe('milestones — a database failure reaches the caller', () => {
  // Resolving to [] here would render a dream as having no tappe at all, which for the owner
  // looks like their roadmap was wiped rather than that the read failed.
  it('listMilestones rethrows instead of reporting a dream with no tappe', async () => {
    const fake = makeFakeClient({ 'dream_milestones.select': [{ error: DB_DOWN }] });
    await expect(listMilestones(asClient(fake), DREAM)).rejects.toMatchObject({ code: '57P01' });
  });

  it('addMilestone rethrows so the composer does not clear the draft', async () => {
    const fake = makeFakeClient({ 'dream_milestones.insert': [{ error: DB_DOWN }] });
    await expect(
      addMilestone(asClient(fake), { dream_id: DREAM, body: 'Trovare la sala' }),
    ).rejects.toMatchObject({ code: '57P01' });
  });

  // A void-returning mutation that swallows its error is the worst shape of all: the UI marks
  // the tappa done, the row never changed, and the +10 award never fires (rule #1 path).
  it('updateMilestoneStatus rethrows rather than reporting a silent success', async () => {
    const fake = makeFakeClient({ 'dream_milestones.update': [{ error: DB_DOWN }] });
    await expect(updateMilestoneStatus(asClient(fake), MS, 'done')).rejects.toMatchObject({
      code: '57P01',
    });
  });

  it('softDeleteMilestone rethrows rather than reporting a silent success', async () => {
    const fake = makeFakeClient({ 'dream_milestones.update': [{ error: DB_DOWN }] });
    await expect(softDeleteMilestone(asClient(fake), MS)).rejects.toMatchObject({ code: '57P01' });
  });

  // Not a response PostgREST can send — a zero-match list select returns [], and after the
  // rethrow above TypeScript has already narrowed `data` to T[]. The `?? []` is a belt-and-braces
  // guard, and this pins it so a "simplification" that removes it fails rather than passing.
  // arm is what stops that becoming a TypeError on `.map`.
  it('listMilestones treats a null payload as no tappe, not a crash', async () => {
    const fake = makeFakeClient({ 'dream_milestones.select': [{ data: null }] });
    await expect(listMilestones(asClient(fake), DREAM)).resolves.toEqual([]);
  });
});
