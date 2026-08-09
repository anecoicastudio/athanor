import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import { createMoment, getMomentsPage, momentKeys, softDeleteMoment } from './moments';
import { asClient, DB_DOWN, makeFakeClient } from './test-support/fake-client';

const OWNER = '00000000-0000-0000-0000-000000000001';
const M1 = '00000000-0000-0000-0000-0000000000a1';
const M2 = '00000000-0000-0000-0000-0000000000a2';

const BASE_MOMENT = {
  id: M1,
  owner_id: OWNER,
  kind: 'photo' as const,
  media_path: 'moments/u1/photo.jpg',
  thumb_path: null,
  caption: null,
  duration_s: null,
  width: null,
  height: null,
  created_at: '2026-01-02T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  deleted_at: null,
};

/** Thenable PostgREST-builder stub: records calls; awaiting resolves to { data, error }. */
function stub(rows: Array<Record<string, unknown>> = []) {
  const calls: Array<{ method: string; arg: unknown; arg2?: unknown }> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'order', 'limit', 'or', 'single']) {
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
  // single() returns first row as data (or null), matching PostgREST behaviour
  chain['single'] = () => {
    calls.push({ method: 'single', arg: undefined });
    return {
      then: (resolve: (v: { data: unknown; error: null }) => void) =>
        resolve({ data: rows[0] ?? null, error: null }),
    };
  };
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
    resolve({ data: rows, error: null });
  const client = { from: () => chain } as unknown as AthanorClient;
  return { client, calls };
}

describe('momentKeys', () => {
  it('list factory shape', () => {
    expect(momentKeys.list('u1')).toEqual(['moments', 'list', 'u1']);
  });

  it('all shape', () => {
    expect(momentKeys.all).toEqual(['moments']);
  });
});

describe('getMomentsPage', () => {
  it('returns nextCursor from the last row when a full page is returned', async () => {
    // Build PAGE_SIZE=24 rows with varying timestamps; use 2 distinct to keep it small by
    // overriding limit to 2 and supplying exactly 2 rows.
    const rows = [
      { ...BASE_MOMENT, id: M1, created_at: '2026-01-02T00:00:00Z' },
      { ...BASE_MOMENT, id: M2, created_at: '2026-01-01T00:00:00Z' },
    ];
    const { client } = stub(rows);
    const page = await getMomentsPage(client, OWNER, null, 2);
    // Full page (2 rows, limit=2) → nextCursor is last row
    expect(page.nextCursor).toEqual({ created_at: '2026-01-01T00:00:00Z', id: M2 });
    expect(page.moments).toHaveLength(2);
  });

  it('returns nextCursor = null when a partial page is returned', async () => {
    const rows = [{ ...BASE_MOMENT, id: M1, created_at: '2026-01-02T00:00:00Z' }];
    const { client } = stub(rows);
    // limit=24 (default), but only 1 row returned → partial page
    const page = await getMomentsPage(client, OWNER, null);
    expect(page.nextCursor).toBeNull();
    expect(page.moments).toHaveLength(1);
  });

  it('filters by owner_id and excludes deleted rows', async () => {
    const { client, calls } = stub([]);
    await getMomentsPage(client, OWNER);
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'owner_id' && c.arg2 === OWNER)).toBe(
      true,
    );
    expect(calls.some((c) => c.method === 'is' && c.arg === 'deleted_at' && c.arg2 === null)).toBe(
      true,
    );
  });

  it('orders by (created_at desc, id desc) — keyset never offset', async () => {
    const { client, calls } = stub([]);
    await getMomentsPage(client, OWNER);
    const orders = calls.filter((c) => c.method === 'order').map((c) => c.arg);
    expect(orders).toEqual(['created_at', 'id']);
  });

  it('applies the or-cursor when a cursor is provided', async () => {
    const cursor = { created_at: '2026-01-01T00:00:00Z', id: M1 };
    const { client, calls } = stub([]);
    await getMomentsPage(client, OWNER, cursor);
    const orCall = calls.find((c) => c.method === 'or');
    expect(orCall).toBeDefined();
    expect(orCall?.arg).toContain(`created_at.lt.${cursor.created_at}`);
    expect(orCall?.arg).toContain(`id.lt.${cursor.id}`);
  });
});

describe('softDeleteMoment', () => {
  it('sets deleted_at and scopes to the id', async () => {
    const { client, calls } = stub();
    await softDeleteMoment(client, M1);
    const update = calls.find((c) => c.method === 'update');
    expect(update?.arg).toHaveProperty('deleted_at');
    expect((update?.arg as { deleted_at: string }).deleted_at).toEqual(expect.any(String));
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'id' && c.arg2 === M1)).toBe(true);
    expect(calls.some((c) => c.method === 'is' && c.arg === 'deleted_at' && c.arg2 === null)).toBe(
      true,
    );
  });
});

describe('moments — a database failure reaches the caller', () => {
  it('getMomentsPage rethrows instead of rendering an empty grid', async () => {
    const fake = makeFakeClient({ 'moments.select': [{ error: DB_DOWN }] });
    await expect(getMomentsPage(asClient(fake), OWNER)).rejects.toMatchObject({
      code: '57P01',
    });
  });

  // The bytes are already in the moments bucket by the time this row insert runs, so swallowing
  // the error would leave an orphaned object that only the GDPR reaper would ever collect.
  it('createMoment rethrows rather than orphaning the uploaded bytes', async () => {
    const fake = makeFakeClient({ 'moments.insert': [{ error: DB_DOWN }] });
    await expect(
      createMoment(asClient(fake), {
        owner_id: OWNER,
        kind: 'photo',
        media_path: `${OWNER}/m1.jpg`,
        thumb_path: null,
        caption: null,
        duration_s: null,
        width: null,
        height: null,
      }),
    ).rejects.toMatchObject({ code: '57P01' });
  });

  it('softDeleteMoment rethrows rather than reporting a silent success', async () => {
    const fake = makeFakeClient({ 'moments.update': [{ error: DB_DOWN }] });
    await expect(softDeleteMoment(asClient(fake), M1)).rejects.toMatchObject({ code: '57P01' });
  });

  it('getMomentsPage holds its empty-payload guard', async () => {
    const fake = makeFakeClient({ 'moments.select': [{ data: null }] });
    await expect(getMomentsPage(asClient(fake), OWNER)).resolves.toMatchObject({
      moments: [],
    });
  });
});
