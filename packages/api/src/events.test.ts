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
  getEventSeatsTaken,
  getEventsByOrganizer,
  getEventsCalendar,
  getEventsNearby,
  getEventsOnline,
  getMyRsvp,
  getMyTicket,
  registerAthanorDaysInterest,
  subscribeAttendance,
  subscribeEventLive,
  subscribeEventPresence,
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

describe('eventKeys.seats', () => {
  it('namespaces the seats-taken count distinctly under the events root', () => {
    expect(eventKeys.seats('e1')).toEqual(['events', 'seats', 'e1']);
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
    settlement_ack_at: null,
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
  expires_at: null,
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

  // #103 — the server's {error} string is the contract; the screen maps it to copy.
  it('reads the refusal body off FunctionsHttpError.context into a TicketCheckoutError', async () => {
    const httpError = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: { status: 403, json: () => Promise.resolve({ error: 'organizer not verified' }) },
    });
    const invoke = vi.fn().mockResolvedValue({ data: null, error: httpError });
    const { client } = withFn(invoke);

    await expect(createTicketCheckout(client, E)).rejects.toMatchObject({
      name: 'TicketCheckoutError',
      code: 'organizer not verified',
      status: 403,
    });
  });

  it('rethrows the raw error when the refusal body is unreadable', async () => {
    const httpError = Object.assign(new Error('non-2xx'), {
      context: { status: 500, json: () => Promise.reject(new Error('not json')) },
    });
    const invoke = vi.fn().mockResolvedValue({ data: null, error: httpError });
    const { client } = withFn(invoke);
    await expect(createTicketCheckout(client, E)).rejects.toThrow('non-2xx');
  });

  it('rethrows the raw error when the body carries no {error} string', async () => {
    const httpError = Object.assign(new Error('non-2xx'), {
      context: { status: 500, json: () => Promise.resolve({ unrelated: true }) },
    });
    const invoke = vi.fn().mockResolvedValue({ data: null, error: httpError });
    const { client } = withFn(invoke);
    await expect(createTicketCheckout(client, E)).rejects.toThrow('non-2xx');
  });
});

describe('getEventSeatsTaken', () => {
  it('reads the definer count rpc for this event (#105)', async () => {
    const fake = makeFakeClient({ 'rpc.event_seats_taken': [{ data: 7 }] });
    await expect(getEventSeatsTaken(asClient(fake), E)).resolves.toBe(7);
    const rpc = fake.calls.find((c) => c.op === 'rpc');
    expect(rpc?.columns).toBe('event_seats_taken');
    expect(rpc?.values).toEqual({ p_event_id: E });
  });

  it('treats a null count as zero and surfaces errors', async () => {
    const empty = makeFakeClient({ 'rpc.event_seats_taken': [{ data: null }] });
    await expect(getEventSeatsTaken(asClient(empty), E)).resolves.toBe(0);

    const failing = makeFakeClient({ 'rpc.event_seats_taken': [{ error: { message: 'boom' } }] });
    await expect(getEventSeatsTaken(asClient(failing), E)).rejects.toBeTruthy();
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
        { data: [{ event_id: E, is_live: true, updated_at: '2026-09-01T18:05:00Z' }] },
      ],
    });
    await expect(getEventLiveStats(asClient(fake), E)).resolves.toMatchObject({
      is_live: true,
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
    // A paid event carries the organiser's settlement acknowledgement, or the schema and the RPC
    // both refuse it (#437).
    settlement_ack: true,
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
      p_settlement_ack: true,
    });
  });

  it('refuses a paid event with no acknowledgement before the rpc is reached (#437)', async () => {
    // The client half of the gate. It matters that nothing is SENT: an RPC that refuses is the
    // durable check, but a request that never leaves is the one the organiser experiences.
    // `false`, not an absent key — an unticked box is what a client actually sends. The absent
    // case is the schema's own test (packages/schemas/src/event.test.ts).
    const fake = makeFakeClient({ 'rpc.create_event': [{ data: E }] });
    await expect(
      createEvent(asClient(fake), { ...input, settlement_ack: false }),
    ).rejects.toThrow();
    expect(fake.calls).toEqual([]);
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
  it('forwards live-flag rows to the callback', () => {
    const fake = makeFakeClient();
    const seen: unknown[] = [];
    subscribeEventLive(asClient(fake), E, (s) => seen.push(s));
    handlerOf(fake)({
      new: { event_id: E, is_live: true, updated_at: '2026-09-01T18:05:00Z' },
    });
    expect(seen).toEqual([{ event_id: E, is_live: true, updated_at: '2026-09-01T18:05:00Z' }]);
  });
});

describe('subscribeEventPresence', () => {
  // The presence sync handler is the first (and only) .on() registration of the room's channel.
  const syncHandlerOf = (fake: ReturnType<typeof makeFakeClient>, index = 0) =>
    fake.channels[index]!.events[0]![2] as () => void;

  it('shares ONE un-suffixed room per event and reports its size to every observer', () => {
    const fake = makeFakeClient();
    const counts: number[] = [];
    const c1 = subscribeEventPresence(asClient(fake), E, (n) => counts.push(n));
    const c2 = subscribeEventPresence(asClient(fake), E, (n) => counts.push(n * 10));

    // one shared channel, bare topic — a channelTopic() suffix would put each
    // subscriber in a private room of one and the count would never move
    expect(fake.channels).toHaveLength(1);
    expect(fake.channels[0]!.name).toBe(`event:${E}:presence`);

    fake.channels[0]!.presence = { 'conn-a': [{}], 'conn-b': [{}] };
    syncHandlerOf(fake)();
    expect(counts).toEqual([2, 20]);

    c1();
    expect(fake.channels[0]!.removed).toBe(false); // second observer still in the room
    c2();
    expect(fake.channels[0]!.removed).toBe(true);
  });

  it('tracks once no matter how many trackers, untracks when the last leaves (rule api.md)', () => {
    const fake = makeFakeClient();
    const t1 = subscribeEventPresence(asClient(fake), E, () => {}, { track: true });
    const t2 = subscribeEventPresence(asClient(fake), E, () => {}, { track: true });

    expect(fake.channels[0]!.tracked).toHaveLength(1);

    t1();
    expect(fake.channels[0]!.untracked).toBe(0);
    t2();
    expect(fake.channels[0]!.untracked).toBe(1);
    expect(fake.channels[0]!.removed).toBe(true);
  });

  it('separates rooms per event and survives double cleanup', () => {
    const fake = makeFakeClient();
    const c1 = subscribeEventPresence(asClient(fake), E, () => {});
    subscribeEventPresence(asClient(fake), E2, () => {});

    expect(fake.channels).toHaveLength(2);
    expect(fake.channels.map((c) => c.name)).toEqual([
      `event:${E}:presence`,
      `event:${E2}:presence`,
    ]);

    c1();
    c1(); // idempotent — a second call must not double-remove or throw
    expect(fake.channels[0]!.removed).toBe(true);
    expect(fake.channels[1]!.removed).toBe(false);
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

// ── null payloads and the arms that guard them ───────────────────────────────
// supabase-js returns `[]` from a successful list `.select()` and `null` only alongside an
// error, which the preceding `if (error) throw` already consumes — so these `?? []` arms are
// type-narrowing defence rather than a shape PostgREST routinely produces. They are worth
// pinning anyway: `head: true` counts and `.maybeSingle()` DO yield null on success, and the
// arms were unreached, so nothing would have caught a reader that dropped one and threw on
// `.map` of null.
describe('events — a null payload is an empty result, not a crash', () => {
  it('getEventsCalendar', async () => {
    const fake = makeFakeClient({ 'events.select': [{ data: null }] });
    await expect(getEventsCalendar(asClient(fake))).resolves.toEqual({
      events: [],
      nextCursor: null,
    });
  });

  it('getEventsOnline', async () => {
    const fake = makeFakeClient({ 'events.select': [{ data: null }] });
    await expect(getEventsOnline(asClient(fake))).resolves.toEqual([]);
  });

  it('getEventsByOrganizer', async () => {
    const fake = makeFakeClient({ 'events.select': [{ data: null }] });
    await expect(getEventsByOrganizer(asClient(fake), 'u1')).resolves.toEqual([]);
  });

  it('getEventsNearby', async () => {
    const fake = makeFakeClient({ 'rpc.events_nearby': [{ data: null }] });
    await expect(getEventsNearby(asClient(fake), 45.4, 9.2)).resolves.toEqual({
      events: [],
      nextCursor: null,
    });
  });

  it('getEventAttendees reports zero rather than throwing on a null preview', async () => {
    const fake = makeFakeClient({
      'rsvps.select': [{ count: null }, { data: null }],
    });
    await expect(getEventAttendees(asClient(fake), 'e1')).resolves.toEqual({
      count: 0,
      userIds: [],
    });
  });

  it('getEventCheckinCount reports zero when the count comes back null', async () => {
    const fake = makeFakeClient({ 'event_attendance.select': [{ count: null }] });
    await expect(getEventCheckinCount(asClient(fake), 'e1')).resolves.toBe(0);
  });
});

describe('events — cursor arms carry the keyset forward (rule #9)', () => {
  // getEventsCalendar's cursor arm is already covered above; only the RPC-shaped one is new.
  it('getEventsNearby passes the cursor to the RPC and omits it when absent', async () => {
    const withCursor = makeFakeClient({ 'rpc.events_nearby': [{ data: [] }] });
    await getEventsNearby(asClient(withCursor), 45.4, 9.2, 10, { dist: 1200, id: 'e9' });
    expect(withCursor.calls[0]!.values).toMatchObject({ cursor_dist: 1200, cursor_id: 'e9' });

    const without = makeFakeClient({ 'rpc.events_nearby': [{ data: [] }] });
    await getEventsNearby(asClient(without), 45.4, 9.2);
    expect(without.calls[0]!.values).not.toHaveProperty('cursor_dist');
    expect(without.calls[0]!.values).not.toHaveProperty('cursor_id');
  });
});

describe('events — createEvent forwards only the fields that were set', () => {
  // eventCreateSchema.superRefine requires a stream_url for an online event, so the base
  // fixture carries one. EventCreate is the post-parse type, so every optional is present as
  // null — the point here is which of them reach the RPC.
  const base = {
    title: 'Ceramica al tramonto',
    category: 'networking' as const,
    is_online: true,
    venue: null,
    city: null,
    lat: null,
    long: null,
    stream_url: 'https://meet.example/abc',
    starts_at: '2026-09-01T18:00:00Z',
    ends_at: null,
    capacity: null,
    price_cents: 0,
    currency: 'eur',
    settlement_ack: false,
  };

  it('an online event forwards its stream url and omits the physical-venue fields', async () => {
    const fake = makeFakeClient({
      'rpc.create_event': [{ data: E }],
      'events.select': [{ data: evt() }],
    });
    await createEvent(asClient(fake), base);
    const args = fake.calls[0]!.values as Record<string, unknown>;
    expect(args).toMatchObject({ p_stream_url: 'https://meet.example/abc' });
    // Unset optionals must be absent, not sent as undefined: the RPC has its own defaults.
    for (const k of ['p_venue', 'p_city', 'p_lat', 'p_long', 'p_ends_at', 'p_capacity']) {
      expect(args).not.toHaveProperty(k);
    }
  });

  it('a free event omits p_price_cents entirely', async () => {
    // price_cents is only sent when non-zero, so a free event must carry no price at all.
    // (`base` is already free and in eur; the currency arm is covered by the gbp case above.)
    const fake = makeFakeClient({
      'rpc.create_event': [{ data: E }],
      'events.select': [{ data: evt() }],
    });
    await createEvent(asClient(fake), base);
    expect(fake.calls[0]!.values).not.toHaveProperty('p_price_cents');
  });

  it('a free event omits p_settlement_ack, ticked or not (#437)', async () => {
    // The RPC defaults it to false and stamps nothing on a free event. Sending `false` would be
    // noise; sending `true` would record an acknowledgement of terms that do not apply.
    for (const settlement_ack of [false, true]) {
      const fake = makeFakeClient({
        'rpc.create_event': [{ data: E }],
        'events.select': [{ data: evt() }],
      });
      await createEvent(asClient(fake), { ...base, settlement_ack });
      expect(fake.calls[0]!.values, `settlement_ack: ${settlement_ack}`).not.toHaveProperty(
        'p_settlement_ack',
      );
    }
  });

  it('throws when the RPC reports an id the follow-up read cannot find', async () => {
    // The RPC returning an id the caller cannot then read means RLS hid it. Returning a
    // half-built object would put an event on screen that does not exist for this member.
    const fake = makeFakeClient({
      'rpc.create_event': [{ data: E }],
      'events.select': [{ data: null }],
    });
    await expect(createEvent(asClient(fake), base)).rejects.toThrow('created event not found');
  });
});
