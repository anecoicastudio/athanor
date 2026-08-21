import { describe, expect, it, vi } from 'vitest';
import { asClient, DB_DOWN, makeFakeClient } from './test-support/fake-client';
import { getPublicEventById, listUpcomingEventIds, publicEventKeys } from './public-event';

const EVENT_ID = '00000000-0000-0000-0000-0000000000e1';
const ORGANIZER_ID = '00000000-0000-0000-0000-0000000000f1';

const eventRow = {
  id: EVENT_ID,
  title: 'Sera di incontri',
  category: 'networking',
  is_online: false,
  venue: 'Casa delle Idee',
  city: 'Milano',
  starts_at: '2026-09-01T18:00:00.000Z',
  ends_at: '2026-09-01T21:00:00.000Z',
  price_cents: 1500,
  currency: 'eur',
  is_kairos_day: false,
  is_athanor_day: false,
  organizer_id: ORGANIZER_ID,
};

describe('public-event api', () => {
  it('key factory shape', () => {
    expect(publicEventKeys.detail(EVENT_ID)).toEqual(['publicEvent', 'detail', EVENT_ID]);
  });

  /*
   * The route segment is user input straight off a URL. Postgres rejects a non-uuid
   * comparison with 22P02, which PostgREST surfaces as an error — so without this guard
   * /event/<anything> is a 500 rather than a 404, and a crawler hitting a stale link
   * gets a server error instead of a clean not-found.
   */
  it.each(['not-a-uuid', '', '../admin', '00000000-0000-0000-0000', `${EVENT_ID} or 1=1`])(
    'returns null for the non-uuid segment %j without touching the database',
    async (segment) => {
      const fake = makeFakeClient();
      expect(await getPublicEventById(asClient(fake), segment)).toBeNull();
      expect(fake.calls).toHaveLength(0);
    },
  );

  it('returns null when no row resolves (deleted, or never existed)', async () => {
    const fake = makeFakeClient({ 'events.select': [{ data: null }] });
    expect(await getPublicEventById(asClient(fake), EVENT_ID)).toBeNull();
  });

  it('assembles the event with the organizer handle', async () => {
    const fake = makeFakeClient({
      'events.select': [{ data: eventRow }],
      'profiles.select': [{ data: { handle: 'sole' } }],
    });
    const res = await getPublicEventById(asClient(fake), EVENT_ID);
    expect(res).toMatchObject({
      title: 'Sera di incontri',
      city: 'Milano',
      organizer_handle: 'sole',
    });
  });

  /*
   * RLS returns no profile row when the organizer has no public section. That is a
   * normal page, not an error: the event stays public, the organizer just is not named.
   */
  it('leaves organizer_handle null when the organizer profile is not public', async () => {
    const fake = makeFakeClient({
      'events.select': [{ data: eventRow }],
      'profiles.select': [{ data: null }],
    });
    const res = await getPublicEventById(asClient(fake), EVENT_ID);
    expect(res?.organizer_handle).toBeNull();
    expect(res?.title).toBe('Sera di incontri');
  });

  it('never selects geo, stream_url, fee_pct or capacity', async () => {
    const fake = makeFakeClient({
      'events.select': [{ data: eventRow }],
      'profiles.select': [{ data: { handle: 'sole' } }],
    });
    await getPublicEventById(asClient(fake), EVENT_ID);
    const columns = fake.calls.find((c) => c.table === 'events')?.columns ?? '';
    for (const forbidden of ['geo', 'stream_url', 'fee_pct', 'capacity']) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it('drops organizer_id rather than publishing the organizer user id', async () => {
    const fake = makeFakeClient({
      'events.select': [{ data: eventRow }],
      'profiles.select': [{ data: { handle: 'sole' } }],
    });
    const res = await getPublicEventById(asClient(fake), EVENT_ID);
    expect(res).not.toHaveProperty('organizer_id');
  });

  it('filters soft-deleted rows at the query, not only at RLS', async () => {
    const fake = makeFakeClient({
      'events.select': [{ data: eventRow }],
      'profiles.select': [{ data: { handle: 'sole' } }],
    });
    await getPublicEventById(asClient(fake), EVENT_ID);
    const filters = fake.calls.find((c) => c.table === 'events')?.filters ?? [];
    expect(filters).toContainEqual(['is', 'deleted_at', null]);
  });

  it('rethrows when the event lookup fails, rather than 404-ing a real event', async () => {
    const fake = makeFakeClient({ 'events.select': [{ error: DB_DOWN }] });
    await expect(getPublicEventById(asClient(fake), EVENT_ID)).rejects.toMatchObject({
      code: '57P01',
    });
  });

  /*
   * A failed organizer lookup must not degrade to an unattributed page: that reads as
   * "this organizer chose to stay private", which is a different and false statement.
   */
  it('rethrows when the organizer lookup fails, rather than publishing an unattributed event', async () => {
    const fake = makeFakeClient({
      'events.select': [{ data: eventRow }],
      'profiles.select': [{ error: DB_DOWN }],
    });
    await expect(getPublicEventById(asClient(fake), EVENT_ID)).rejects.toMatchObject({
      code: '57P01',
    });
  });
});

describe('listUpcomingEventIds', () => {
  const NOW = new Date('2026-08-21T09:00:00.000Z');
  const entry = (over: Record<string, unknown> = {}) => ({
    id: EVENT_ID,
    updated_at: '2026-08-01T10:00:00Z',
    ...over,
  });

  it('reads the next N upcoming, undeleted events soonest first, from the injected clock', async () => {
    const fake = makeFakeClient({ 'events.select': [{ data: [entry()] }] });
    const res = await listUpcomingEventIds(asClient(fake), { limit: 50, now: NOW });
    expect(res).toEqual({ entries: [entry()], excluded: 0 });
    const call = fake.calls[0]!;
    expect(call.table).toBe('events');
    expect(call.op).toBe('select');
    expect(call.columns).toBe('id, updated_at');
    expect(call.filters).toEqual([
      ['is', 'deleted_at', null],
      ['gte', 'starts_at', NOW.toISOString()],
    ]);
    expect(call.modifiers).toEqual([
      ['order', 'starts_at', { ascending: true }],
      ['order', 'id', { ascending: true }],
      ['limit', 50],
    ]);
  });

  it('defaults the cutoff to the clock', async () => {
    const fake = makeFakeClient({ 'events.select': [{ data: [] }] });
    const before = Date.now();
    await listUpcomingEventIds(asClient(fake), { limit: 5 });
    const gte = fake.calls[0]!.filters.find((f) => f[0] === 'gte')!;
    const cutoff = Date.parse(String(gte[2]));
    expect(cutoff).toBeGreaterThanOrEqual(before);
    expect(cutoff).toBeLessThanOrEqual(Date.now());
  });

  it('withholds a row the schema rejects and counts it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = makeFakeClient({
      'events.select': [{ data: [entry({ id: 'not-a-uuid' }), entry()] }],
    });
    const res = await listUpcomingEventIds(asClient(fake), { limit: 5, now: NOW });
    expect(res.entries.map((e) => e.id)).toEqual([EVENT_ID]);
    expect(res.excluded).toBe(1);
    expect(warn.mock.calls[0]![0]).toContain('not-a-uuid');
    warn.mockRestore();
  });

  it('throws when the database errors', async () => {
    const fake = makeFakeClient({ 'events.select': [{ error: DB_DOWN }] });
    await expect(listUpcomingEventIds(asClient(fake), { limit: 5, now: NOW })).rejects.toEqual(
      DB_DOWN,
    );
  });

  it('a null payload is an empty index, not a crash', async () => {
    const fake = makeFakeClient({ 'events.select': [{ data: null }] });
    await expect(listUpcomingEventIds(asClient(fake), { limit: 5, now: NOW })).resolves.toEqual({
      entries: [],
      excluded: 0,
    });
  });
});
