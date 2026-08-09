import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import { createDream, dreamKeys, getActiveDream, upsertActiveDream } from './dreams';
import { asClient, DB_DOWN, makeFakeClient } from './test-support/fake-client';

const UUID = '00000000-0000-0000-0000-0000000000a1';

/** Minimal thenable PostgREST-builder stub: records called methods, resolves to
 *  `{ error: null }` when awaited and `{ data }` from maybeSingle(). */
function stub(existing: Record<string, unknown> | null) {
  const calls: Array<{ method: string; arg: unknown; arg2?: unknown }> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'is', 'update', 'insert']) {
    chain[m] = (arg?: unknown) => {
      calls.push({ method: m, arg });
      return chain;
    };
  }
  // eq records both column and value so tests can assert row-scoping predicates.
  chain['eq'] = (col: unknown, val?: unknown) => {
    calls.push({ method: 'eq', arg: col, arg2: val });
    return chain;
  };
  chain.maybeSingle = async () => ({ data: existing, error: null });
  chain.then = (resolve: (v: { error: null }) => void) => resolve({ error: null });
  // SupabaseClient is a deep generic the stub can't satisfy structurally — cast is test-only.
  const client = { from: () => chain } as unknown as AthanorClient;
  return { client, calls };
}

describe('dreams api', () => {
  it('key factory shape', () => {
    expect(dreamKeys.byProfile('p1')).toEqual(['dreams', 'profile', 'p1']);
  });

  it('upsert inserts (trimmed) when no active dream exists', async () => {
    const { client, calls } = stub(null);
    await upsertActiveDream(client, UUID, '  Aprire uno studio  ');
    const insert = calls.find((c) => c.method === 'insert');
    expect(insert?.arg).toEqual({ profile_id: UUID, text: 'Aprire uno studio' });
    expect(calls.some((c) => c.method === 'update')).toBe(false);
  });

  it('upsert updates the active row when one exists', async () => {
    const existing = {
      id: '11111111-1111-1111-1111-111111111111',
      profile_id: UUID,
      text: 'Vecchio sogno',
      status: 'active',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      deleted_at: null,
    };
    const { client, calls } = stub(existing);
    await upsertActiveDream(client, UUID, 'Nuovo sogno');
    const update = calls.find((c) => c.method === 'update');
    expect(update?.arg).toEqual({ text: 'Nuovo sogno' });
    expect(calls.some((c) => c.method === 'insert')).toBe(false);
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'id' && c.arg2 === existing.id)).toBe(
      true,
    );
  });
});

// `upsertActiveDream` reads then writes, so it has two failure points and two write paths;
// only the happy ones were covered. A swallowed error on either leaves the editor believing the
// dream was saved — the one piece of text the whole profile is built around.
describe('dreams — a database failure reaches the caller', () => {
  it('getActiveDream rethrows instead of reporting no dream planted', async () => {
    const fake = makeFakeClient({ 'dreams.select': [{ error: DB_DOWN }] });
    await expect(getActiveDream(asClient(fake), UUID)).rejects.toMatchObject({ code: '57P01' });
  });

  it('upsertActiveDream rethrows when updating the existing active row fails', async () => {
    const fake = makeFakeClient({
      'dreams.select': [
        {
          data: {
            id: UUID,
            profile_id: UUID,
            text: 'il mio sogno',
            status: 'active',
            created_at: '2026-07-02T00:00:00Z',
            updated_at: '2026-07-02T00:00:00Z',
            deleted_at: null,
          },
        },
      ],
      'dreams.update': [{ error: DB_DOWN }],
    });
    await expect(upsertActiveDream(asClient(fake), UUID, 'nuovo testo')).rejects.toMatchObject({
      code: '57P01',
    });
  });

  it('createDream rethrows on the first-plant insert', async () => {
    const fake = makeFakeClient({ 'dreams.insert': [{ error: DB_DOWN }] });
    await expect(
      createDream(asClient(fake), { profile_id: UUID, text: 'il mio sogno' }),
    ).rejects.toMatchObject({ code: '57P01' });
  });
});
