import { expect, test } from 'vitest';
import { searchAll, searchKeys } from './search';
import { makeFakeClient } from './test-support/fake-client';
import type { AthanorClient } from './client';

test('searchKeys.all shape', () => {
  expect(searchKeys.all).toEqual(['search']);
});

test('searchKeys.query factory shape', () => {
  expect(searchKeys.query('mar', 'people')).toEqual([
    'search',
    'query',
    { q: 'mar', scope: 'people', filters: undefined },
  ]);
});

test('searchKeys.query includes filters when provided', () => {
  const filters = { auraMin: 10, city: 'Milano' };
  expect(searchKeys.query('mar', 'projects', filters)).toEqual([
    'search',
    'query',
    { q: 'mar', scope: 'projects', filters },
  ]);
});

test('searchKeys.query with all scope and no filters', () => {
  expect(searchKeys.query('', 'all')).toEqual([
    'search',
    'query',
    { q: '', scope: 'all', filters: undefined },
  ]);
});

// ---------------------------------------------------------------------------
// searchAll — one keyset page from the search_all SECURITY INVOKER rpc.
// ---------------------------------------------------------------------------

const ID1 = '00000000-0000-0000-0000-0000000000a1';
const ID2 = '00000000-0000-0000-0000-0000000000a2';

const hit = (over: Record<string, unknown> = {}) => ({
  entity_type: 'person',
  id: ID1,
  title: 'Elena',
  subtitle: 'designer · Milano',
  rank: 0.9,
  ...over,
});

const asClient = (fake: ReturnType<typeof makeFakeClient>) => fake as unknown as AthanorClient;

test('searchAll queries the search_all rpc with the term and scope', async () => {
  const fake = makeFakeClient({ 'rpc.search_all': [{ data: [hit()] }] });
  const page = await searchAll(asClient(fake), { q: 'elen', scope: 'people' });

  expect(page.rows).toHaveLength(1);
  expect(fake.calls[0]!.table).toBe('rpc');
  expect(fake.calls[0]!.columns).toBe('search_all');
  expect(fake.calls[0]!.values).toMatchObject({ q: 'elen', scope: 'people' });
});

test('searchAll forwards advanced filters verbatim for the server to gate', async () => {
  const fake = makeFakeClient({ 'rpc.search_all': [{ data: [] }] });
  await searchAll(asClient(fake), {
    q: 'elen',
    scope: 'people',
    filters: { auraMin: 300, city: 'Milano', star: 'mentor' },
  });

  expect(fake.calls[0]!.values).toMatchObject({
    f_aura_min: 300,
    f_city: 'Milano',
    f_star: 'mentor',
  });
});

test('searchAll never checks membership itself before sending filters', async () => {
  const fake = makeFakeClient({ 'rpc.search_all': [{ data: [] }] });
  await searchAll(asClient(fake), { q: 'elen', scope: 'people', filters: { auraMin: 300 } });

  expect(fake.calls).toHaveLength(1);
  expect(
    fake.calls.some((c) => ['entitlements', 'circle_memberships', 'aura_scores'].includes(c.table)),
  ).toBe(false);
});

test('searchAll paginates on a keyset and never an offset (rule #9)', async () => {
  const fake = makeFakeClient({ 'rpc.search_all': [{ data: [] }] });
  await searchAll(asClient(fake), {
    q: 'elen',
    scope: 'all',
    cursor: { rank: 0.42, id: ID1 },
  });

  expect(fake.calls[0]!.values).toMatchObject({ cursor_rank: 0.42, cursor_id: ID1 });
  expect(fake.calls[0]!.modifiers.some((m) => m[0] === 'range')).toBe(false);
  expect(Object.keys(fake.calls[0]!.values as object)).not.toContain('offset');
});

test('searchAll hands back a cursor built from the last row of a full page', async () => {
  const rows = Array.from({ length: 20 }, (_, i) =>
    hit({ id: i === 19 ? ID2 : ID1, rank: 1 - i / 100 }),
  );
  const fake = makeFakeClient({ 'rpc.search_all': [{ data: rows }] });
  const page = await searchAll(asClient(fake), { q: 'elen', scope: 'all' });

  expect(page.rows).toHaveLength(20);
  expect(page.nextCursor).toEqual({ rank: rows[19]!.rank, id: ID2 });
});

test('searchAll returns a null cursor on a short page', async () => {
  const fake = makeFakeClient({ 'rpc.search_all': [{ data: [hit()] }] });
  const page = await searchAll(asClient(fake), { q: 'elen', scope: 'all' });
  expect(page.nextCursor).toBeNull();
});

test('searchAll returns an empty page for no matches', async () => {
  const fake = makeFakeClient({ 'rpc.search_all': [{ data: [] }] });
  const page = await searchAll(asClient(fake), { q: 'zzzz', scope: 'all' });
  expect(page).toEqual({ rows: [], nextCursor: null });
});

test('searchAll preserves the server ranking instead of re-sorting locally', async () => {
  const fake = makeFakeClient({
    'rpc.search_all': [
      {
        data: [
          hit({ id: ID1, rank: 0.2, title: 'primo' }),
          hit({ id: ID2, rank: 0.9, title: 'secondo' }),
        ],
      },
    ],
  });
  const page = await searchAll(asClient(fake), { q: 'elen', scope: 'all' });
  expect(page.rows.map((r) => r.title)).toEqual(['primo', 'secondo']);
});

test('searchAll carries mixed entity types through untouched', async () => {
  const fake = makeFakeClient({
    'rpc.search_all': [
      {
        data: [
          hit({ entity_type: 'person' }),
          hit({ entity_type: 'project', id: ID2, title: 'Orto condiviso' }),
          hit({ entity_type: 'event', id: ID2, title: 'Cerchio' }),
        ],
      },
    ],
  });
  const page = await searchAll(asClient(fake), { q: 'o', scope: 'all' });
  expect(page.rows.map((r) => r.entity_type)).toEqual(['person', 'project', 'event']);
});

test('searchAll throws when the rpc errors', async () => {
  const fake = makeFakeClient({ 'rpc.search_all': [{ error: { message: 'boom' } }] });
  await expect(searchAll(asClient(fake), { q: 'elen', scope: 'all' })).rejects.toThrow();
});

test('searchAll performs no write', async () => {
  const fake = makeFakeClient({ 'rpc.search_all': [{ data: [hit()] }] });
  await searchAll(asClient(fake), { q: 'elen', scope: 'all' });
  expect(fake.calls.every((c) => c.op === 'rpc')).toBe(true);
});
