import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import { favorKeys, listOpenNeeds, passFavor } from './favors';
import { keysetFilter } from './pagination';
import { makeFakeClient, type FakeResult } from './test-support/fake-client';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const NEED_M = '33333333-3333-4333-8333-333333333333';

const db = (script: Record<string, FakeResult[]> = {}) => {
  const fake = makeFakeClient(script);
  return { fake, client: fake as unknown as AthanorClient };
};

const need = (n: number) => ({
  need_milestone_id: `4444444${n}-4444-4444-8444-444444444444`,
  need: `un consiglio ${n}`,
  need_created_at: `2026-01-0${n}T00:00:00Z`,
  target_id: TARGET,
  target_handle: 'luce',
  target_display_name: 'Luce Chiara',
  target_avatar_path: 'l/l.jpg',
});

describe('favorKeys', () => {
  it('namespaces openNeeds under the favorOffers root', () => {
    expect(favorKeys.all).toEqual(['favorOffers']);
    expect(favorKeys.openNeeds).toEqual(['favorOffers', 'openNeeds']);
  });
});

describe('listOpenNeeds', () => {
  it('pages by keyset over the favor_needs view — never by offset (rule #9)', async () => {
    const { fake, client } = db({ 'favor_needs.select': [{ data: [need(1)] }] });
    await listOpenNeeds(client, null, 20);

    const call = fake.calls[0]!;
    expect(call.table).toBe('favor_needs');
    expect(call.modifiers.map((m) => m[0])).not.toContain('range');
    // both keyset columns ordered, in the (need_created_at, need_milestone_id) index direction
    expect(call.modifiers).toEqual([
      ['order', 'need_created_at', { ascending: false }],
      ['order', 'need_milestone_id', { ascending: false }],
      ['limit', 20],
    ]);
    // no count/head request: the list is rows, never an aggregate (rule #3)
    expect(call.options).toBeUndefined();
  });

  it('first page carries no cursor predicate', async () => {
    const { fake, client } = db({ 'favor_needs.select': [{ data: [] }] });
    await listOpenNeeds(client);
    expect(fake.calls[0]!.filters).toEqual([]);
  });

  it('a cursor becomes the shared two-column keyset disjunction', async () => {
    const cursor = { need_created_at: '2026-01-02T00:00:00Z', need_milestone_id: NEED_M };
    const { fake, client } = db({ 'favor_needs.select': [{ data: [] }] });
    await listOpenNeeds(client, cursor);

    expect(fake.calls[0]!.filters).toEqual([
      [
        'or',
        keysetFilter(
          'need_created_at',
          'need_milestone_id',
          cursor.need_created_at,
          cursor.need_milestone_id,
          'lt',
        ),
      ],
    ]);
  });

  it('a full page hands back the last row as the next cursor', async () => {
    const { client } = db({ 'favor_needs.select': [{ data: [need(1), need(2)] }] });
    const page = await listOpenNeeds(client, null, 2);
    expect(page.needs).toHaveLength(2);
    expect(page.nextCursor).toEqual({
      need_created_at: need(2).need_created_at,
      need_milestone_id: need(2).need_milestone_id,
    });
  });

  it('a short page ends the walk', async () => {
    const { client } = db({ 'favor_needs.select': [{ data: [need(1)] }] });
    await expect(listOpenNeeds(client, null, 2)).resolves.toMatchObject({ nextCursor: null });
  });

  it('no rows → an empty page, not a throw', async () => {
    const { client } = db({ 'favor_needs.select': [{ data: null }] });
    await expect(listOpenNeeds(client)).resolves.toEqual({ needs: [], nextCursor: null });
  });

  it('surfaces a database error instead of an empty list', async () => {
    const { client } = db({ 'favor_needs.select': [{ error: { message: 'view unavailable' } }] });
    await expect(listOpenNeeds(client)).rejects.toThrow('view unavailable');
  });

  it('rejects a row the favor_needs schema does not recognise', async () => {
    const { client } = db({ 'favor_needs.select': [{ data: [{ need: 'solo questo' }] }] });
    await expect(listOpenNeeds(client)).rejects.toThrow();
  });
});

describe('passFavor', () => {
  it('validates before touching the database', async () => {
    const blank = db();
    await expect(
      passFavor(blank.client, ACTOR, {
        target_id: TARGET,
        need: '   ',
        need_milestone_id: null,
      }),
    ).rejects.toThrow();
    expect(blank.fake.calls).toEqual([]);

    const badTarget = db();
    await expect(
      passFavor(badTarget.client, ACTOR, {
        target_id: 'not-a-uuid',
        need: 'un consiglio',
        need_milestone_id: null,
      }),
    ).rejects.toThrow();
    expect(badTarget.fake.calls).toEqual([]);
  });

  // favorInsertSchema omits actor_id (it comes from auth.uid via RLS), so it cannot mirror
  // the migration's `check (actor_id <> target_id)`. Without this guard the insert was sent
  // and the caller got a raw Postgres constraint error back.
  it('refuses to favor yourself without sending a doomed insert', async () => {
    const { fake, client } = db();
    await expect(
      passFavor(client, ACTOR, { target_id: ACTOR, need: 'un consiglio', need_milestone_id: null }),
    ).rejects.toThrow(/cannot be the actor/i);
    expect(fake.calls).toEqual([]);
  });

  it('still allows a favor to anyone else', async () => {
    const { fake, client } = db();
    await passFavor(client, ACTOR, {
      target_id: TARGET,
      need: 'un consiglio',
      need_milestone_id: null,
    });
    expect(fake.calls).toHaveLength(1);
  });

  it('writes only the client-writable columns; the server owns id and timestamps', async () => {
    const { fake, client } = db();
    await passFavor(client, ACTOR, {
      target_id: TARGET,
      need: 'un consiglio',
      need_milestone_id: NEED_M,
    });

    const call = fake.calls[0]!;
    expect(call.table).toBe('favor_offers');
    expect(call.op).toBe('insert');
    expect(call.values).toEqual({
      actor_id: ACTOR,
      target_id: TARGET,
      need: 'un consiglio',
      need_milestone_id: NEED_M,
    });
    expect(Object.keys(call.values as object)).not.toContain('id');
    expect(Object.keys(call.values as object)).not.toContain('created_at');
    expect(Object.keys(call.values as object)).not.toContain('updated_at');
    expect(Object.keys(call.values as object)).not.toContain('deleted_at');
  });

  it('takes actor_id from the caller, ignoring one smuggled into the payload', async () => {
    const { fake, client } = db();
    await passFavor(client, ACTOR, {
      actor_id: TARGET,
      target_id: TARGET,
      need: 'un consiglio',
      need_milestone_id: null,
    } as never);
    expect((fake.calls[0]!.values as { actor_id: string }).actor_id).toBe(ACTOR);
  });

  it('a favor with no tappa attached is allowed', async () => {
    const { fake, client } = db();
    await passFavor(client, ACTOR, {
      target_id: TARGET,
      need: 'un consiglio',
      need_milestone_id: null,
    });
    expect((fake.calls[0]!.values as { need_milestone_id: null }).need_milestone_id).toBeNull();
  });

  it('never writes an aura row (rule #1)', async () => {
    const { fake, client } = db();
    await passFavor(client, ACTOR, {
      target_id: TARGET,
      need: 'un consiglio',
      need_milestone_id: null,
    });
    expect(fake.calls.every((c) => !c.table.startsWith('aura'))).toBe(true);
  });

  it('surfaces the unique-violation on a repeated favor', async () => {
    const { client } = db({
      'favor_offers.insert': [{ error: { code: '23505', message: 'duplicate key' } }],
    });
    await expect(
      passFavor(client, ACTOR, {
        target_id: TARGET,
        need: 'un consiglio',
        need_milestone_id: null,
      }),
    ).rejects.toThrow('duplicate key');
  });
});
