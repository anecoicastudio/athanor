import { describe, expect, it, vi } from 'vitest';
import { makeFakeClient } from './test-support/fake-client';
import type { AthanorClient } from './client';
import {
  checkInScan,
  createEvent,
  createTicketCheckout,
  eventKeys,
  getEvent,
  getEventAttendees,
  getEventCheckinCount,
  getEventLiveStats,
  getEventsByOrganizer,
  getEventsCalendar,
  getEventsNearby,
  getEventsOnline,
  getMyRsvp,
  getMyTicket,
  registerAthanorDaysInterest,
  subscribeAttendance,
  subscribeEventLive,
  subscribeTicket,
  upsertRsvp,
} from './events';

describe('eventKeys', () => {
  it('namespaces rsvp + attendees distinctly under the events root', () => {
    expect(eventKeys.all).toEqual(['events']);
    expect(eventKeys.detail('e1')).toEqual(['events', 'detail', 'e1']);
    expect(eventKeys.rsvp('e1')).toEqual(['events', 'rsvp', 'e1']);
    expect(eventKeys.attendees('e1')).toEqual(['events', 'attendees', 'e1']);
  });
});

describe('eventKeys.liveStats', () => {
  it('namespaces live stats distinctly under the events root', () => {
    expect(eventKeys.liveStats('e1')).toEqual(['events', 'liveStats', 'e1']);
  });
});

describe('subscribeEventLive', () => {
  it('returns a cleanup fn and removes the channel when called (rule api.md)', () => {
    let removed: unknown = null;
    const channel = { on: () => channel, subscribe: () => channel };
    const fakeClient = {
      channel: () => channel,
      removeChannel: (c: unknown) => {
        removed = c;
      },
    } as unknown as Parameters<typeof subscribeEventLive>[0];

    const cleanup = subscribeEventLive(fakeClient, 'e1', () => {});
    expect(typeof cleanup).toBe('function');
    cleanup();
    expect(removed).toBe(channel);
  });
});

describe('eventKeys.ticket', () => {
  it('namespaces a ticket under the events root', () => {
    expect(eventKeys.ticket('e1')).toEqual(['events', 'ticket', 'e1']);
  });
});

describe('subscribeTicket', () => {
  it('returns a cleanup fn that removes the channel (rule api.md)', () => {
    let removed: unknown = null;
    const channel = { on: () => channel, subscribe: () => channel };
    const fakeClient = {
      channel: () => channel,
      removeChannel: (c: unknown) => {
        removed = c;
      },
    } as unknown as Parameters<typeof subscribeTicket>[0];

    const cleanup = subscribeTicket(fakeClient, 'e1', 'u1', () => {});
    expect(typeof cleanup).toBe('function');
    cleanup();
    expect(removed).toBe(channel);
  });
});

// ---------------------------------------------------------------------------
// Behavioural coverage. Fixtures are full rows so the module's own parse step is
// exercised rather than bypassed.
// ---------------------------------------------------------------------------

const U = '00000000-0000-0000-0000-0000000000a1';
const U2 = '00000000-0000-0000-0000-0000000000a2';
const E = '00000000-0000-0000-0000-0000000000e1';
const E2 = '00000000-0000-0000-0000-0000000000e2';

const AURA_TABLES = ['aura_events', 'aura_scores', 'stars'];
/** Rule #1: nothing in this package may write the score tables. */
const auraWrites = (fake: ReturnType<typeof makeFakeClient>) =>
  fake.calls.filter((c) => AURA_TABLES.includes(c.table) && c.op !== 'select');

function evt(over: Record<string, unknown> = {}) {
  return {
    id: E,
    organizer_id: U,
    title: 'Cerchio di apertura',
    category: 'networking',
    is_online: false,
    venue: 'Cascina Cuccagna',
    city: 'Milano',
    stream_url: null,
    starts_at: '2026-09-01T18:00:00Z',
    ends_at: null,
    capacity: 40,
    price_cents: 0,
    currency: 'eur',
    fee_pct: 10,
    is_kairos_day: false,
    is_athanor_day: false,
    cover_url: null,
    live_started_at: null,
    live_ended_at: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    deleted_at: null,
    ...over,
  };
}

const ticketRow = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-0000-0000-0000000000f1',
  user_id: U,
  event_id: E,
  stripe_payment_id: null,
  qr_token: null,
  status: 'pending',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  ...over,
});

/** The fake client plus a scripted `functions.invoke` (edge-fn surface). */
function withFn(
  invoke: ReturnType<typeof vi.fn>,
  script: Record<string, { data?: unknown; error?: unknown; count?: number }[]> = {},
) {
  const fake = makeFakeClient(script);
  return { fake, client: { ...fake, functions: { invoke } } as unknown as AthanorClient };
}

const asClient = (fake: ReturnType<typeof makeFakeClient>) => fake as unknown as AthanorClient;

// ---------------------------------------------------------------------------
// Ticketing — rule #6: Stripe is the source of truth, money is server-side only
// ---------------------------------------------------------------------------

describe('createTicketCheckout', () => {
  it('mints the session in the edge function and sends no client-side price (rule #6)', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ data: { url: 'https://checkout.stripe/x' }, error: null });
    const { client } = withFn(invoke);

    await expect(createTicketCheckout(client, E)).resolves.toEqual({
      url: 'https://checkout.stripe/x',
    });

    const [fnName, opts] = invoke.mock.calls[0]!;
    expect(fnName).toBe('create-ticket-checkout');
    // The event id is the ONLY thing the client is trusted with; the amount, the
    // currency, the platform fee and the Stripe price all come from the server.
    expect(opts.body).toEqual({ eventId: E });
    const bodyKeys = Object.keys(opts.body as object);
    for (const forbidden of [
      'amount',
      'price',
      'priceCents',
      'price_cents',
      'currency',
      'feePct',
      'priceId',
    ]) {
      expect(bodyKeys).not.toContain(forbidden);
    }
  });

  it('writes no ticket row itself — the webhook issues it (rule #6)', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { url: 'https://c' }, error: null });
    const { fake, client } = withFn(invoke);
    await createTicketCheckout(client, E);
    expect(fake.calls).toEqual([]);
  });

  it('awards no Aura (rule #1)', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { url: 'https://c' }, error: null });
    const { fake, client } = withFn(invoke);
    await createTicketCheckout(client, E);
    expect(auraWrites(fake)).toEqual([]);
  });

  it('surfaces an edge-function failure instead of returning a bare url', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: new Error('stripe down') });
    const { client } = withFn(invoke);
    await expect(createTicketCheckout(client, E)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Check-in (PRD §4.6: organizer scans → attendance recorded server-side)
// ---------------------------------------------------------------------------

describe('checkInScan', () => {
  it('submits the scanned token to the organizer-gated check-in function', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ data: { result: 'valid', name: 'elena' }, error: null });
    const { client } = withFn(invoke);

    await expect(checkInScan(client, E, 'qr-abc')).resolves.toEqual({
      result: 'valid',
      name: 'elena',
    });
    expect(invoke).toHaveBeenCalledWith('check-in', { body: { eventId: E, qrToken: 'qr-abc' } });
  });

  it.each(['valid', 'already', 'invalid', 'wrongEvent'] as const)(
    'passes the %s verdict through without throwing',
    async (result) => {
      const invoke = vi.fn().mockResolvedValue({ data: { result }, error: null });
      const { client } = withFn(invoke);
      await expect(checkInScan(client, E, 'qr')).resolves.toMatchObject({ result });
    },
  );

  it('never records attendance or flips the ticket client-side (rule #6/#8)', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { result: 'valid' }, error: null });
    const { fake, client } = withFn(invoke);
    await checkInScan(client, E, 'qr');
    expect(fake.calls).toEqual([]);
    expect(auraWrites(fake)).toEqual([]);
  });

  it('rejects a verdict the schema does not recognise', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { result: 'maybe' }, error: null });
    const { client } = withFn(invoke);
    await expect(checkInScan(client, E, 'qr')).rejects.toThrow();
  });

  it('surfaces an edge-function failure', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: new Error('not organizer') });
    const { client } = withFn(invoke);
    await expect(checkInScan(client, E, 'qr')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// RSVP — free events, 1-tap, idempotent (PRD §4.6)
// ---------------------------------------------------------------------------

describe('upsertRsvp', () => {
  it('records a going RSVP keyed on (user_id, event_id) so a second tap is a no-op', async () => {
    const fake = makeFakeClient();
    await upsertRsvp(asClient(fake), E, U, true);
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.table).toBe('rsvps');
    expect(call.op).toBe('upsert');
    expect(call.values).toEqual({ user_id: U, event_id: E, status: 'going' });
    expect(call.options).toMatchObject({ onConflict: 'user_id,event_id' });
  });

  it('cancels by flipping status, never by deleting the row', async () => {
    const fake = makeFakeClient();
    await upsertRsvp(asClient(fake), E, U, false);
    expect(fake.calls[0]!.values).toEqual({ user_id: U, event_id: E, status: 'cancelled' });
    expect(fake.calls.some((c) => c.op === 'delete')).toBe(false);
  });

  it('awards no Aura — the +15 attend point is the score-engine (rule #1)', async () => {
    const fake = makeFakeClient();
    await upsertRsvp(asClient(fake), E, U, true);
    expect(auraWrites(fake)).toEqual([]);
  });

  it('throws when the database rejects the write', async () => {
    const fake = makeFakeClient({ 'rsvps.upsert': [{ error: { message: 'rls denied' } }] });
    await expect(upsertRsvp(asClient(fake), E, U, true)).rejects.toThrow();
  });
});

describe('getMyRsvp', () => {
  it('scopes the read to the caller and the event', async () => {
    const row = {
      id: '00000000-0000-0000-0000-0000000000b1',
      user_id: U,
      event_id: E,
      status: 'going',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-01T00:00:00Z',
    };
    const fake = makeFakeClient({ 'rsvps.select': [{ data: [row] }] });
    await expect(getMyRsvp(asClient(fake), E, U)).resolves.toMatchObject({ status: 'going' });
    expect(fake.calls[0]!.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'event_id', E],
        ['eq', 'user_id', U],
      ]),
    );
  });

  it('returns null when the viewer never RSVPd', async () => {
    const fake = makeFakeClient({ 'rsvps.select': [{ data: [] }] });
    await expect(getMyRsvp(asClient(fake), E, U)).resolves.toBeNull();
  });

  it('throws when the database errors', async () => {
    const fake = makeFakeClient({ 'rsvps.select': [{ error: { message: 'boom' } }] });
    await expect(getMyRsvp(asClient(fake), E, U)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Ticket reads — owner-reads-own
// ---------------------------------------------------------------------------

describe('getMyTicket', () => {
  it('scopes the read to both the event and the caller', async () => {
    const fake = makeFakeClient({
      'event_tickets.select': [{ data: [ticketRow({ status: 'paid' })] }],
    });
    await expect(getMyTicket(asClient(fake), E, U)).resolves.toMatchObject({ status: 'paid' });
    expect(fake.calls[0]!.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'event_id', E],
        ['eq', 'user_id', U],
      ]),
    );
  });

  it('returns null when the viewer holds no ticket', async () => {
    const fake = makeFakeClient({ 'event_tickets.select': [{ data: [] }] });
    await expect(getMyTicket(asClient(fake), E, U)).resolves.toBeNull();
  });

  it('never writes the money cache (rule #6)', async () => {
    const fake = makeFakeClient({ 'event_tickets.select': [{ data: [] }] });
    await getMyTicket(asClient(fake), E, U);
    expect(fake.calls.every((c) => c.op === 'select')).toBe(true);
  });

  it('throws when the database errors', async () => {
    const fake = makeFakeClient({ 'event_tickets.select': [{ error: { message: 'boom' } }] });
    await expect(getMyTicket(asClient(fake), E, U)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Rule #9 — cursor pagination, never offset
// ---------------------------------------------------------------------------

describe('getEventsCalendar', () => {
  it('keyset-paginates and never issues an offset range', async () => {
    const fake = makeFakeClient({
      'events.select': [
        { data: [evt({ id: E }), evt({ id: E2, starts_at: '2026-09-02T18:00:00Z' })] },
      ],
    });
    const page = await getEventsCalendar(asClient(fake), null, 2);

    expect(page.events).toHaveLength(2);
    expect(page.nextCursor).toEqual({ starts_at: '2026-09-02T18:00:00Z', id: E2 });
    const call = fake.calls[0]!;
    expect(call.modifiers.some((m) => m[0] === 'range')).toBe(false);
    expect(call.modifiers).toEqual(expect.arrayContaining([['limit', 2]]));
    expect(call.filters).toEqual(expect.arrayContaining([['is', 'deleted_at', null]]));
  });

  it('returns a null cursor on a short page', async () => {
    const fake = makeFakeClient({ 'events.select': [{ data: [evt()] }] });
    const page = await getEventsCalendar(asClient(fake), null, 20);
    expect(page.nextCursor).toBeNull();
  });

  it('carries the cursor as a keyset predicate, not an offset', async () => {
    const fake = makeFakeClient({ 'events.select': [{ data: [] }] });
    await getEventsCalendar(asClient(fake), { starts_at: '2026-09-01T18:00:00Z', id: E }, 20);
    const or = fake.calls[0]!.filters.find((f) => f[0] === 'or');
    expect(or).toBeDefined();
    expect(String(or?.[1])).toContain('starts_at.gt.2026-09-01T18:00:00Z');
    expect(fake.calls[0]!.modifiers.some((m) => m[0] === 'range')).toBe(false);
  });

  it('throws when the database errors', async () => {
    const fake = makeFakeClient({ 'events.select': [{ error: { message: 'boom' } }] });
    await expect(getEventsCalendar(asClient(fake))).rejects.toThrow();
  });
});

describe('getEventsNearby', () => {
  const nearby = (over: Record<string, unknown> = {}) => ({
    id: E,
    title: 'Cerchio',
    category: 'networking',
    starts_at: '2026-09-01T18:00:00Z',
    venue: 'Cascina',
    city: 'Milano',
    dist_meters: 1200,
    ...over,
  });

  it('asks the server for the distance and converts the radius to metres', async () => {
    const fake = makeFakeClient({ 'rpc.events_nearby': [{ data: [nearby()] }] });
    const page = await getEventsNearby(asClient(fake), 45.46, 9.19, 10);

    expect(page.events).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.table).toBe('rpc');
    expect(call.columns).toBe('events_nearby');
    expect(call.values).toMatchObject({ lat: 45.46, long: 9.19, radius_m: 10000 });
  });

  it('keyset-paginates on (dist, id) with no offset', async () => {
    const fake = makeFakeClient({
      'rpc.events_nearby': [{ data: [nearby(), nearby({ id: E2, dist_meters: 3400 })] }],
    });
    const page = await getEventsNearby(asClient(fake), 45.46, 9.19, 10, null, 2);
    expect(page.nextCursor).toEqual({ dist: 3400, id: E2 });
    expect(fake.calls[0]!.modifiers.some((m) => m[0] === 'range')).toBe(false);
  });

  it('returns a null cursor on a short page', async () => {
    const fake = makeFakeClient({ 'rpc.events_nearby': [{ data: [nearby()] }] });
    const page = await getEventsNearby(asClient(fake), 45.46, 9.19, 10, null, 20);
    expect(page.nextCursor).toBeNull();
  });

  it('throws when the rpc errors', async () => {
    const fake = makeFakeClient({ 'rpc.events_nearby': [{ error: { message: 'boom' } }] });
    await expect(getEventsNearby(asClient(fake), 45.46, 9.19, 10)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

describe('getEvent', () => {
  it('excludes soft-deleted events', async () => {
    const fake = makeFakeClient({ 'events.select': [{ data: [evt()] }] });
    await expect(getEvent(asClient(fake), E)).resolves.toMatchObject({ id: E });
    expect(fake.calls[0]!.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'id', E],
        ['is', 'deleted_at', null],
      ]),
    );
  });

  it('returns null when the event is missing or deleted', async () => {
    const fake = makeFakeClient({ 'events.select': [{ data: [] }] });
    await expect(getEvent(asClient(fake), E)).resolves.toBeNull();
  });

  it('throws when the database errors', async () => {
    const fake = makeFakeClient({ 'events.select': [{ error: { message: 'boom' } }] });
    await expect(getEvent(asClient(fake), E)).rejects.toThrow();
  });
});

describe('getEventsOnline', () => {
  it('reads only online, non-deleted events', async () => {
    const fake = makeFakeClient({
      'events.select': [{ data: [evt({ is_online: true, stream_url: 'https://s', venue: null })] }],
    });
    await expect(getEventsOnline(asClient(fake))).resolves.toHaveLength(1);
    expect(fake.calls[0]!.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'is_online', true],
        ['is', 'deleted_at', null],
      ]),
    );
  });

  it('throws when the database errors', async () => {
    const fake = makeFakeClient({ 'events.select': [{ error: { message: 'boom' } }] });
    await expect(getEventsOnline(asClient(fake))).rejects.toThrow();
  });
});

describe('getEventsByOrganizer', () => {
  it('scopes to the organizer and hides soft-deleted rows', async () => {
    const fake = makeFakeClient({ 'events.select': [{ data: [evt()] }] });
    await expect(getEventsByOrganizer(asClient(fake), U)).resolves.toHaveLength(1);
    expect(fake.calls[0]!.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'organizer_id', U],
        ['is', 'deleted_at', null],
      ]),
    );
  });

  it('throws when the database errors', async () => {
    const fake = makeFakeClient({ 'events.select': [{ error: { message: 'boom' } }] });
    await expect(getEventsByOrganizer(asClient(fake), U)).rejects.toThrow();
  });
});

describe('getEventAttendees', () => {
  it('returns a head count plus a capped preview, never the full list (PRD §4.5)', async () => {
    const fake = makeFakeClient({
      'rsvps.select': [{ data: [], count: 42 }, { data: [{ user_id: U }, { user_id: U2 }] }],
    });
    const preview = await getEventAttendees(asClient(fake), E, 2);

    expect(preview.count).toBe(42);
    expect(preview.userIds).toEqual([U, U2]);
    expect(fake.calls[0]!.options).toMatchObject({ count: 'exact', head: true });
    expect(fake.calls[1]!.modifiers).toEqual(expect.arrayContaining([['limit', 2]]));
    expect(
      fake.calls.every((c) => c.filters.some((f) => f[1] === 'status' && f[2] === 'going')),
    ).toBe(true);
  });

  it('reports zero when nobody is going', async () => {
    const fake = makeFakeClient({ 'rsvps.select': [{ data: [], count: 0 }, { data: [] }] });
    const preview = await getEventAttendees(asClient(fake), E);
    expect(preview).toEqual({ count: 0, userIds: [] });
  });

  it('throws when the count query errors', async () => {
    const fake = makeFakeClient({ 'rsvps.select': [{ error: { message: 'boom' } }] });
    await expect(getEventAttendees(asClient(fake), E)).rejects.toThrow();
  });
});

describe('getEventCheckinCount', () => {
  it('reads a head-only count for the event', async () => {
    const fake = makeFakeClient({ 'event_attendance.select': [{ data: [], count: 12 }] });
    await expect(getEventCheckinCount(asClient(fake), E)).resolves.toBe(12);
    expect(fake.calls[0]!.options).toMatchObject({ count: 'exact', head: true });
    expect(fake.calls[0]!.filters).toEqual(expect.arrayContaining([['eq', 'event_id', E]]));
  });

  it('throws when the database errors', async () => {
    const fake = makeFakeClient({ 'event_attendance.select': [{ error: { message: 'boom' } }] });
    await expect(getEventCheckinCount(asClient(fake), E)).rejects.toThrow();
  });
});

describe('getEventLiveStats', () => {
  it('returns the row when the stream has stats', async () => {
    const fake = makeFakeClient({
      'event_live_stats.select': [
        {
          data: [
            { event_id: E, listener_count: 7, is_live: true, updated_at: '2026-09-01T18:05:00Z' },
          ],
        },
      ],
    });
    await expect(getEventLiveStats(asClient(fake), E)).resolves.toMatchObject({
      listener_count: 7,
    });
  });

  it('returns null before the first stats row exists', async () => {
    const fake = makeFakeClient({ 'event_live_stats.select': [{ data: [] }] });
    await expect(getEventLiveStats(asClient(fake), E)).resolves.toBeNull();
  });

  it('throws when the database errors', async () => {
    const fake = makeFakeClient({ 'event_live_stats.select': [{ error: { message: 'boom' } }] });
    await expect(getEventLiveStats(asClient(fake), E)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

describe('createEvent', () => {
  const input = {
    title: 'Cerchio di apertura',
    category: 'networking' as const,
    is_online: false,
    venue: 'Cascina Cuccagna',
    city: 'Milano',
    lat: 45.45,
    long: 9.2,
    stream_url: null,
    starts_at: '2026-09-01T18:00:00Z',
    ends_at: '2026-09-01T20:00:00Z',
    capacity: 40,
    price_cents: 1500,
    currency: 'eur',
  };

  it('creates through the create_event rpc so the server builds the geo point', async () => {
    const fake = makeFakeClient({
      'rpc.create_event': [{ data: E }],
      'events.select': [{ data: [evt()] }],
    });
    await expect(createEvent(asClient(fake), input)).resolves.toMatchObject({ id: E });

    const rpc = fake.calls[0]!;
    expect(rpc.columns).toBe('create_event');
    expect(rpc.values).toMatchObject({
      p_title: 'Cerchio di apertura',
      p_category: 'networking',
      p_is_online: false,
      p_starts_at: '2026-09-01T18:00:00Z',
      p_venue: 'Cascina Cuccagna',
      p_city: 'Milano',
      p_lat: 45.45,
      p_long: 9.2,
      p_ends_at: '2026-09-01T20:00:00Z',
      p_capacity: 40,
      p_price_cents: 1500,
    });
  });

  it('forwards the currency the organizer chose to the rpc', async () => {
    const fake = makeFakeClient({
      'rpc.create_event': [{ data: E }],
      'events.select': [{ data: [evt({ currency: 'gbp' })] }],
    });
    await createEvent(asClient(fake), { ...input, currency: 'gbp' });
    expect(fake.calls[0]!.values).toMatchObject({ p_currency: 'gbp' });
  });

  it('never sets the platform fee client-side (rule #6)', async () => {
    const fake = makeFakeClient({
      'rpc.create_event': [{ data: E }],
      'events.select': [{ data: [evt()] }],
    });
    await createEvent(asClient(fake), input);
    expect(Object.keys(fake.calls[0]!.values as object)).not.toContain('p_fee_pct');
  });

  it('awards no Aura — the +30 organize point is the score-engine (rule #1)', async () => {
    const fake = makeFakeClient({
      'rpc.create_event': [{ data: E }],
      'events.select': [{ data: [evt()] }],
    });
    await createEvent(asClient(fake), input);
    expect(auraWrites(fake)).toEqual([]);
  });

  it('throws when the rpc rejects the insert', async () => {
    const fake = makeFakeClient({ 'rpc.create_event': [{ error: { message: 'rls denied' } }] });
    await expect(createEvent(asClient(fake), input)).rejects.toThrow();
  });
});

describe('registerAthanorDaysInterest', () => {
  it('is idempotent — a second "Avvisami" tap adds nothing', async () => {
    const fake = makeFakeClient();
    await registerAthanorDaysInterest(asClient(fake), U);
    const call = fake.calls[0]!;
    expect(call.table).toBe('athanor_days_interest');
    expect(call.op).toBe('upsert');
    expect(call.options).toMatchObject({ ignoreDuplicates: true });
  });

  it('records the edition when one is given', async () => {
    const fake = makeFakeClient();
    await registerAthanorDaysInterest(asClient(fake), U, '2027');
    expect(fake.calls[0]!.values).toMatchObject({ user_id: U, edition: '2027' });
  });

  it('throws when the database errors', async () => {
    const fake = makeFakeClient({
      'athanor_days_interest.upsert': [{ error: { message: 'boom' } }],
    });
    await expect(registerAthanorDaysInterest(asClient(fake), U)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Realtime payload handling
// ---------------------------------------------------------------------------

/** Pull the postgres_changes handler the module registered on the Nth channel. */
function handlerOf(fake: ReturnType<typeof makeFakeClient>, index = 0) {
  const args = fake.channels[index]!.events[0]!;
  return args[2] as (payload: { new: unknown }) => void;
}

describe('subscribeTicket', () => {
  it('delivers the caller"s own ticket to the callback', () => {
    const fake = makeFakeClient();
    const seen: unknown[] = [];
    subscribeTicket(asClient(fake), E, U, (t) => seen.push(t));
    handlerOf(fake)({ new: ticketRow({ status: 'paid', qr_token: 'qr-1' }) });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ status: 'paid', qr_token: 'qr-1' });
  });

  it('drops a ticket belonging to another member', () => {
    const fake = makeFakeClient();
    const seen: unknown[] = [];
    subscribeTicket(asClient(fake), E, U, (t) => seen.push(t));
    handlerOf(fake)({ new: ticketRow({ user_id: U2, status: 'paid' }) });
    expect(seen).toEqual([]);
  });

  it('subscribes on the event_tickets table for this event', () => {
    const fake = makeFakeClient();
    subscribeTicket(asClient(fake), E, U, () => {});
    expect(fake.channels[0]!.events[0]![1]).toMatchObject({
      table: 'event_tickets',
      filter: `event_id=eq.${E}`,
    });
    expect(fake.channels[0]!.subscribed).toBe(true);
  });
});

describe('subscribeAttendance', () => {
  it('forwards each new check-in row and cleans up the channel', () => {
    const fake = makeFakeClient();
    const seen: unknown[] = [];
    const cleanup = subscribeAttendance(asClient(fake), E, (row) => seen.push(row));

    expect(fake.channels[0]!.events[0]![1]).toMatchObject({
      event: 'INSERT',
      table: 'event_attendance',
    });
    handlerOf(fake)({
      new: {
        id: '00000000-0000-0000-0000-0000000000c1',
        ticket_id: '00000000-0000-0000-0000-0000000000f1',
        event_id: E,
        checked_in_at: '2026-09-01T18:30:00Z',
        scanned_by: U,
        created_at: '2026-09-01T18:30:00Z',
      },
    });
    expect(seen).toHaveLength(1);

    cleanup();
    expect(fake.channels[0]!.removed).toBe(true);
  });
});

describe('subscribeEventLive', () => {
  it('forwards live stats rows to the callback', () => {
    const fake = makeFakeClient();
    const seen: unknown[] = [];
    subscribeEventLive(asClient(fake), E, (s) => seen.push(s));
    handlerOf(fake)({
      new: { event_id: E, listener_count: 3, is_live: true, updated_at: '2026-09-01T18:05:00Z' },
    });
    expect(seen).toEqual([
      { event_id: E, listener_count: 3, is_live: true, updated_at: '2026-09-01T18:05:00Z' },
    ]);
  });
});

describe('eventKeys namespacing', () => {
  it('gives every cache slot a distinct key under the events root', () => {
    const keys = [
      eventKeys.all,
      eventKeys.nearby(45.46, 9.19, 10),
      eventKeys.calendar(),
      eventKeys.online(),
      eventKeys.today(),
      eventKeys.detail(E),
      eventKeys.byOrganizer(U),
      eventKeys.rsvp(E),
      eventKeys.attendees(E),
      eventKeys.liveStats(E),
      eventKeys.ticket(E),
      eventKeys.checkin(E),
    ];

    expect(keys.every((k) => k[0] === 'events')).toBe(true);
    expect(new Set(keys.map((k) => JSON.stringify(k))).size).toBe(keys.length);
  });

  it('separates the cache per event so one event"s ticket never serves another', () => {
    expect(eventKeys.ticket(E)).not.toEqual(eventKeys.ticket(E2));
    expect(eventKeys.nearby(45.46, 9.19, 10)).not.toEqual(eventKeys.nearby(45.46, 9.19, 25));
  });
});
