import { describe, expect, it, vi } from 'vitest';
import type { AthanorClient } from './client';
import { asClient, DB_DOWN, makeFakeClient } from './test-support/fake-client';
import { getAuthorReactionCount, getViewerReaction, togglePostReaction } from './post-reactions';

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

describe('post-reactions — a database failure reaches the caller', () => {
  // A swallowed error here would render the ✦ unlit for someone who has already lit it, and
  // the next tap would try to insert a duplicate against the (post, person) unique constraint.
  it('getViewerReaction rethrows instead of reporting "not reacted"', async () => {
    const fake = makeFakeClient({ 'post_reactions.select': [{ error: DB_DOWN }] });
    await expect(getViewerReaction(asClient(fake), POST)).rejects.toMatchObject({ code: '57P01' });
  });

  it('togglePostReaction rethrows when the un-light delete fails', async () => {
    const fake = makeFakeClient({
      'post_reactions.select': [{ data: { id: 'r1' } }], // already lit → takes the delete path
      'post_reactions.delete': [{ error: DB_DOWN }],
    });
    await expect(togglePostReaction(asClient(fake), POST, PERSON)).rejects.toMatchObject({
      code: '57P01',
    });
  });

  it('togglePostReaction rethrows when the light insert fails', async () => {
    const fake = makeFakeClient({
      'post_reactions.select': [{ data: null }], // not lit → takes the insert path
      'post_reactions.insert': [{ error: DB_DOWN }],
    });
    await expect(togglePostReaction(asClient(fake), POST, PERSON)).rejects.toMatchObject({
      code: '57P01',
    });
  });

  // Rule #3 territory: this count is author-only. Coalescing a failure to 0 would show the
  // author "nobody lit this" — a vanity metric that is not merely absent but wrong.
  it('getAuthorReactionCount rethrows instead of reporting zero reactions', async () => {
    const fake = makeFakeClient({ 'rpc.post_reaction_count': [{ error: DB_DOWN }] });
    await expect(getAuthorReactionCount(asClient(fake), POST)).rejects.toMatchObject({
      code: '57P01',
    });
  });
});
