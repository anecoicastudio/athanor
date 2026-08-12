import { describe, expect, it } from 'vitest';
import { asClient, DB_DOWN, makeFakeClient } from './test-support/fake-client';
import { getPublicEventById, publicEventKeys } from './public-event';

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
