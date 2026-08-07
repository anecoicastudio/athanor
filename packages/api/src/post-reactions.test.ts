import { describe, expect, it, vi } from 'vitest';
import type { AthanorClient } from './client';
import { getAuthorReactionCount, togglePostReaction } from './post-reactions';

const POST = '00000000-0000-0000-0000-0000000000b1';
const PERSON = '00000000-0000-0000-0000-000000000001';

/**
 * Thenable PostgREST-builder stub: records calls in order; `maybeSingle` resolves
 * to the first seeded row (the viewer's own reaction row) or null.
 */
function stub(rows: Array<Record<string, unknown>> = []) {
  const calls: Array<{ method: string; arg: unknown; arg2?: unknown }> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'delete']) {
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
  const client = {
    from: (table: unknown) => {
      calls.push({ method: 'from', arg: table });
      return chain;
    },
  } as unknown as AthanorClient;
  return { client, calls };
}

describe('togglePostReaction', () => {
  it('already reacted → deletes the own row and returns false (exact sequence)', async () => {
    const { client, calls } = stub([{ id: '00000000-0000-0000-0000-0000000000r1' }]);
    const lit = await togglePostReaction(client, POST, PERSON);
    expect(lit).toBe(false);
    // read (select own row) then write (delete own row) — nothing else
    expect(calls.map((c) => c.method)).toEqual([
      'from',
      'select',
      'eq',
      'maybeSingle',
      'from',
      'delete',
      'eq',
      'eq',
    ]);
    const eqs = calls.filter((c) => c.method === 'eq');
    expect(eqs[0]).toMatchObject({ arg: 'post_id', arg2: POST }); // read scope
    expect(eqs[1]).toMatchObject({ arg: 'post_id', arg2: POST }); // delete scope
    expect(eqs[2]).toMatchObject({ arg: 'person_id', arg2: PERSON });
    expect(calls.some((c) => c.method === 'insert')).toBe(false);
  });

  it('not reacted → inserts (post_id, person_id) and returns true (exact sequence)', async () => {
    const { client, calls } = stub([]);
    const lit = await togglePostReaction(client, POST, PERSON);
    expect(lit).toBe(true);
    expect(calls.map((c) => c.method)).toEqual([
      'from',
      'select',
      'eq',
      'maybeSingle',
      'from',
      'insert',
    ]);
    const insert = calls.find((c) => c.method === 'insert');
    expect(insert?.arg).toEqual({ post_id: POST, person_id: PERSON });
    expect(calls.some((c) => c.method === 'delete')).toBe(false);
  });
});

describe('getAuthorReactionCount', () => {
  it('calls the post_reaction_count rpc with the post id', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 5, error: null });
    const client = { rpc } as unknown as AthanorClient;
    const count = await getAuthorReactionCount(client, POST);
    expect(rpc).toHaveBeenCalledWith('post_reaction_count', { p_post_id: POST });
    expect(count).toBe(5);
  });

  it('falls back to 0 when the rpc returns null data', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { rpc } as unknown as AthanorClient;
    await expect(getAuthorReactionCount(client, POST)).resolves.toBe(0);
  });
});
