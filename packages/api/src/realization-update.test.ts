import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import {
  UPDATES_PAGE_SIZE,
  deleteRealizationUpdate,
  editRealizationUpdate,
  getRealizationUpdates,
  postRealizationUpdate,
  realizationUpdateKeys,
  updateRefusalOf,
} from './realization-update';

const EDITION = '00000000-0000-0000-0000-0000000000e1';
const AUTHOR = '00000000-0000-0000-0000-000000000001';
const PHASE = '00000000-0000-0000-0000-0000000000f1';

/** A real uuid per fixture row: the schema validates the shape it will see from PostgREST. */
const uid = (n: number) => `00000000-0000-0000-0000-0000000a${String(n).padStart(4, '0')}`;

const row = (n: number, created_at: string, extra: Record<string, unknown> = {}) => ({
  id: uid(n),
  edition_id: EDITION,
  profile_id: AUTHOR,
  plan_phase_id: null,
  body: 'Le chiavi sono nostre.',
  deleted_at: null,
  created_at,
  updated_at: created_at,
  ...extra,
});

/**
 * Thenable PostgREST-builder stub (the realization-plan.test.ts idiom): records the chain,
 * resolves the terminal call with { data, error }. The feed reads through `then`, the
 * mutations through `single`.
 */
function stub(data: unknown = null, error: unknown = null) {
  const calls: Array<{ method: string; arg: unknown; arg2?: unknown }> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'or', 'order', 'limit', 'insert', 'update']) {
    chain[m] = (arg?: unknown, arg2?: unknown) => {
      calls.push({ method: m, arg, arg2 });
      return chain;
    };
  }
  chain['single'] = () => {
    calls.push({ method: 'single', arg: undefined });
    return Promise.resolve({ data, error });
  };
  chain['then'] = (resolve: (v: unknown) => unknown) => resolve({ data, error });
  const client = { from: () => chain } as unknown as AthanorClient;
  return { client, calls };
}

describe('realizationUpdateKeys', () => {
  it("scopes the public feed and the author's own trail separately", () => {
    expect(realizationUpdateKeys.all).toEqual(['realizationUpdate']);
    expect(realizationUpdateKeys.feed(EDITION)).toEqual(['realizationUpdate', 'feed', EDITION]);
    expect(realizationUpdateKeys.mine(EDITION)).toEqual(['realizationUpdate', 'mine', EDITION]);
  });
});

describe('getRealizationUpdates', () => {
  it('orders by (created_at desc, id desc) and filters withdrawn rows out of the public feed', async () => {
    const { client, calls } = stub([row(1, '2026-08-16T10:00:00Z')]);
    await getRealizationUpdates(client, EDITION);

    expect(calls.filter((c) => c.method === 'is')).toEqual([
      { method: 'is', arg: 'deleted_at', arg2: null },
    ]);
    const orders = calls.filter((c) => c.method === 'order');
    expect(orders.map((c) => c.arg)).toEqual(['created_at', 'id']);
    expect(orders.every((c) => (c.arg2 as { ascending: boolean }).ascending === false)).toBe(true);
    // Rule #9: no offset/range call exists on the chain at all.
    expect(calls.some((c) => c.method === 'or')).toBe(false);
  });

  it('sends no cursor predicate on the first page and a keyset one after it', async () => {
    const { client, calls } = stub([]);
    await getRealizationUpdates(client, EDITION, {
      cursor: { ts: '2026-08-16T10:00:00Z', id: 'a002' },
    });
    const or = calls.find((c) => c.method === 'or');
    expect(or?.arg).toBe(
      'created_at.lt.2026-08-16T10:00:00Z,and(created_at.eq.2026-08-16T10:00:00Z,id.lt.a002)',
    );
  });

  it('returns a cursor only when the page is full — a short page means done', async () => {
    const full = Array.from({ length: 2 }, (_, i) => row(i, '2026-08-16T10:00:00Z'));
    const { client } = stub(full);
    const page = await getRealizationUpdates(client, EDITION, { limit: 2 });
    expect(page.nextCursor).toEqual({ ts: '2026-08-16T10:00:00Z', id: uid(1) });

    const { client: short } = stub([row(9, '2026-08-16T10:00:00Z')]);
    const last = await getRealizationUpdates(short, EDITION, { limit: 2 });
    expect(last.nextCursor).toBeNull();
  });

  it("keeps withdrawn rows for the author's own screen", async () => {
    const { client, calls } = stub([row(1, '2026-08-16T10:00:00Z', { deleted_at: 'x' })]);
    const page = await getRealizationUpdates(client, EDITION, { includeWithdrawn: true });
    expect(calls.some((c) => c.method === 'is')).toBe(false);
    expect(page.rows[0]?.deleted_at).toBe('x');
  });

  it('defaults to one page of UPDATES_PAGE_SIZE', async () => {
    const { client, calls } = stub([]);
    await getRealizationUpdates(client, EDITION);
    expect(calls.find((c) => c.method === 'limit')?.arg).toBe(UPDATES_PAGE_SIZE);
  });

  it('throws the PostgREST error rather than returning an empty trail', async () => {
    const { client } = stub(null, { message: 'boom' });
    await expect(getRealizationUpdates(client, EDITION)).rejects.toEqual({ message: 'boom' });
  });
});

describe('postRealizationUpdate', () => {
  it('sends the row as given — no client-side winner check to second-guess the database', async () => {
    const { client, calls } = stub(row(7, '2026-08-16T12:00:00Z', { plan_phase_id: PHASE }));
    const saved = await postRealizationUpdate(client, {
      edition_id: EDITION,
      profile_id: AUTHOR,
      plan_phase_id: PHASE,
      body: 'Allestimento finito.',
    });
    expect(calls.find((c) => c.method === 'insert')?.arg).toEqual({
      edition_id: EDITION,
      profile_id: AUTHOR,
      plan_phase_id: PHASE,
      body: 'Allestimento finito.',
    });
    expect(saved.plan_phase_id).toBe(PHASE);
  });

  it('throws the refusal so the screen can name it', async () => {
    const { client } = stub(null, { message: 'not the cycle winner' });
    await expect(
      postRealizationUpdate(client, {
        edition_id: EDITION,
        profile_id: AUTHOR,
        body: 'x',
        plan_phase_id: null,
      }),
    ).rejects.toEqual({ message: 'not the cycle winner' });
  });
});

describe('editRealizationUpdate', () => {
  it('patches only what it was given', async () => {
    const { client, calls } = stub(row(1, '2026-08-16T10:00:00Z', { body: 'corretto' }));
    const saved = await editRealizationUpdate(client, 'a', { body: 'corretto' });
    expect(calls.find((c) => c.method === 'update')?.arg).toEqual({ body: 'corretto' });
    expect(saved.body).toBe('corretto');
  });

  it('throws on error', async () => {
    const { client } = stub(null, { message: 'nope' });
    await expect(editRealizationUpdate(client, 'a', { body: 'x' })).rejects.toEqual({
      message: 'nope',
    });
  });
});

describe('deleteRealizationUpdate', () => {
  it('withdraws by setting deleted_at — never a hard delete', async () => {
    const { client, calls } = stub(null);
    await deleteRealizationUpdate(client, 'a', '2026-08-16T13:00:00Z');
    expect(calls.find((c) => c.method === 'update')?.arg).toEqual({
      deleted_at: '2026-08-16T13:00:00Z',
    });
    expect(calls.some((c) => c.method === 'delete')).toBe(false);
  });

  it('throws on error', async () => {
    const { client } = stub(null, { message: 'nope' });
    await expect(deleteRealizationUpdate(client, 'a', 'now')).rejects.toEqual({ message: 'nope' });
  });
});

describe('updateRefusalOf', () => {
  it('names the refusal PostgREST wrapped', () => {
    expect(updateRefusalOf({ message: 'ERROR: plan phase belongs to another cycle (P0001)' })).toBe(
      'plan phase belongs to another cycle',
    );
    expect(updateRefusalOf({ message: 'not the cycle winner' })).toBe('not the cycle winner');
  });

  it('returns null for anything unnamed — an RLS denial carries no message', () => {
    expect(updateRefusalOf({ message: 'new row violates row-level security policy' })).toBeNull();
    expect(updateRefusalOf(null)).toBeNull();
    expect(updateRefusalOf({})).toBeNull();
    expect(updateRefusalOf('a string, not an error object')).toBeNull();
  });
});
