import { describe, expect, it } from 'vitest';
import {
  attendanceSchema,
  checkInResultSchema,
  eventCalendarFiltersSchema,
  eventCategorySchema,
  eventCreateSchema,
  eventLiveStatsSchema,
  eventNearbySchema,
  eventSchema,
  isEmptyEventCalendarFilters,
  rsvpSchema,
  rsvpStatusSchema,
  ticketSchema,
  ticketStatusSchema,
} from './event';

const baseRow = {
  id: '11111111-1111-1111-1111-111111111111',
  organizer_id: '22222222-2222-2222-2222-222222222222',
  title: 'Notte delle Idee',
  category: 'networking',
  is_online: false,
  venue: 'Spazio X',
  city: 'Berlino',
  stream_url: null,
  starts_at: '2026-07-14T17:00:00.000Z',
  ends_at: null,
  capacity: null,
  price_cents: 0,
  currency: 'eur',
  fee_pct: 10,
  is_athanor_day: false,
  cover_url: null,
  live_started_at: null,
  live_ended_at: null,
  settlement_ack_at: null,
  created_at: '2026-06-15T10:00:00.000Z',
  updated_at: '2026-06-15T10:00:00.000Z',
  deleted_at: null,
};

describe('eventSchema (read)', () => {
  it('parses a valid event row', () => {
    expect(eventSchema.parse(baseRow).title).toBe('Notte delle Idee');
  });
  it('rejects an unknown category', () => {
    expect(() => eventSchema.parse({ ...baseRow, category: 'sport' })).toThrow();
  });
  // baseRow prices the event at 0, which satisfies a floor and a ceiling alike — so the bound
  // could have been inverted and every test here would still pass. A paid event is the case.
  it('carries the settlement acknowledgement timestamp, null on a free event (#437)', () => {
    expect(eventSchema.parse(baseRow).settlement_ack_at).toBeNull();
    const acked = { ...baseRow, price_cents: 2500, settlement_ack_at: '2026-08-18T19:00:00.000Z' };
    expect(eventSchema.parse(acked).settlement_ack_at).toBe('2026-08-18T19:00:00.000Z');
    // Absent, not merely null, is a row that predates the column or a projection that forgot it —
    // EVENT_COLS is an explicit list, so a missing column is a real failure mode here.
    const { settlement_ack_at: _omitted, ...without } = baseRow;
    expect(() => eventSchema.parse(without)).toThrow();
  });
  it('accepts a paid price and rejects a negative one', () => {
    expect(eventSchema.parse({ ...baseRow, price_cents: 2500 }).price_cents).toBe(2500);
    expect(() => eventSchema.parse({ ...baseRow, price_cents: -1 })).toThrow();
  });
  // Both anchors matter: without `^` a 'xeur' passes, without `$` a 'eurx' does, and either
  // would reach Stripe as a currency it does not recognise.
  it('anchors currency to exactly three lowercase letters', () => {
    for (const bad of ['xeur', 'eurx', 'EUR', 'eu', 'euro']) {
      expect(() => eventSchema.parse({ ...baseRow, currency: bad })).toThrow();
    }
  });
});

describe('eventNearbySchema (events_nearby projection)', () => {
  it('parses a nearby projection row', () => {
    const row = {
      id: baseRow.id,
      title: baseRow.title,
      category: 'networking',
      starts_at: baseRow.starts_at,
      venue: 'Spazio X',
      city: 'Berlino',
      dist_meters: 2100,
    };
    expect(eventNearbySchema.parse(row).dist_meters).toBe(2100);
  });
});

describe('eventCreateSchema', () => {
  const physical = {
    title: 'Tavola dei Fondatori',
    category: 'business' as const,
    is_online: false,
    venue: 'Spazio Y',
    city: 'Berlino',
    lat: 52.5,
    long: 13.4,
    stream_url: null,
    starts_at: '2026-07-22T18:00:00.000Z',
    ends_at: null,
    capacity: null,
    price_cents: 0,
    currency: 'eur',
  };

  it('accepts a valid physical event', () => {
    expect(eventCreateSchema.parse(physical).city).toBe('Berlino');
  });
  it('applies defaults for omitted optional fields', () => {
    const parsed = eventCreateSchema.parse({
      title: 'Minimal',
      category: 'arte',
      is_online: false,
      lat: 52.5,
      long: 13.4,
      starts_at: '2026-08-01T18:00:00.000Z',
    });
    expect(parsed.currency).toBe('eur');
    expect(parsed.price_cents).toBe(0);
    expect(parsed.capacity).toBeNull();
    expect(parsed.venue).toBeNull();
  });
  it('rejects a blank (whitespace-only) title', () => {
    expect(() => eventCreateSchema.parse({ ...physical, title: '   ' })).toThrow();
  });
  // The create input re-declares price_cents and currency rather than picking them, so the read
  // schema's bounds above say nothing about these — they are separate constraints.
  it('accepts a paid price and rejects a negative one', () => {
    const paid = { ...physical, price_cents: 2500, settlement_ack: true };
    expect(eventCreateSchema.parse(paid).price_cents).toBe(2500);
    expect(() => eventCreateSchema.parse({ ...paid, price_cents: -1 })).toThrow();
  });
  it('refuses a paid event with no settlement acknowledgement (#437)', () => {
    // #104's deferral was granted on the condition that organisers are told, before they list a
    // paid event, that settlement is manual and on what cadence. This mirrors create_event's own
    // refusal so the form blocks first; the server check is the load-bearing one, because this
    // schema runs on a client.
    const parsed = eventCreateSchema.safeParse({ ...physical, price_cents: 2500 });
    expect(parsed.success).toBe(false);
    const issue = parsed.error?.issues.find((i) => i.path[0] === 'settlement_ack');
    expect(issue?.code).toBe('custom');
    expect(issue?.message).toBe('settlement_ack_required');
  });
  it('leaves a free event alone — nothing to settle, nothing to acknowledge (#437)', () => {
    const parsed = eventCreateSchema.parse(physical);
    expect(parsed.price_cents).toBe(0);
    expect(parsed.settlement_ack).toBe(false);
  });
  it('anchors currency to exactly three lowercase letters', () => {
    for (const bad of ['xeur', 'eurx', 'EUR', 'eu', 'euro']) {
      expect(() => eventCreateSchema.parse({ ...physical, currency: bad })).toThrow();
    }
  });
  it('rejects a physical event without coordinates', () => {
    expect(() => eventCreateSchema.parse({ ...physical, lat: null, long: null })).toThrow();
  });
  // The case above nulls BOTH coordinates, where `||` and `&&` agree — so the refine could have
  // demanded only that they be missing *together* and this suite would pass. Half a coordinate
  // pair is not a location: it would place the event on the equator or the prime meridian.
  it('rejects a physical event with only one of the two coordinates', () => {
    expect(() => eventCreateSchema.parse({ ...physical, long: null })).toThrow();
    expect(() => eventCreateSchema.parse({ ...physical, lat: null })).toThrow();
  });
  // The `path` on each refine is what a create form keys its field-level error off, and the
  // message is the token it looks the i18n copy up by — machine-readable, not user-facing prose
  // (rule #5 keeps the copy in @athanor/i18n). Nothing reads either yet, so blanking them is
  // currently invisible; pinned here so the day a form does read them, they still say this.
  it('routes each refine failure to the field it is about', () => {
    const noCoords = eventCreateSchema.safeParse({ ...physical, lat: null, long: null });
    expect(noCoords.error?.issues[0]?.path).toEqual(['lat']);
    expect(noCoords.error?.issues[0]?.code).toBe('custom');
    expect(noCoords.error?.issues[0]?.message).toBe('location_required');
    const noStream = eventCreateSchema.safeParse({
      ...physical,
      is_online: true,
      stream_url: null,
    });
    expect(noStream.error?.issues[0]?.path).toEqual(['stream_url']);
    expect(noStream.error?.issues[0]?.code).toBe('custom');
    expect(noStream.error?.issues[0]?.message).toBe('stream_url_required');
  });
  it('rejects an online event without a stream URL', () => {
    expect(() =>
      eventCreateSchema.parse({ ...physical, is_online: true, stream_url: null }),
    ).toThrow();
  });
  it('accepts a valid online event', () => {
    expect(
      eventCreateSchema.parse({
        ...physical,
        is_online: true,
        stream_url: 'https://stream.example/live',
        venue: null,
        lat: null,
        long: null,
      }).is_online,
    ).toBe(true);
  });
});

describe('rsvpSchema', () => {
  const valid = {
    id: '11111111-1111-1111-1111-111111111111',
    user_id: '22222222-2222-2222-2222-222222222222',
    event_id: '33333333-3333-3333-3333-333333333333',
    status: 'going',
    created_at: '2026-06-15T10:00:00Z',
    updated_at: '2026-06-15T10:00:00Z',
  };

  it('parses a valid rsvp row', () => {
    expect(rsvpSchema.parse(valid).status).toBe('going');
  });

  it('accepts the cancelled status', () => {
    expect(rsvpStatusSchema.parse('cancelled')).toBe('cancelled');
  });

  it('rejects an unknown status', () => {
    expect(() => rsvpSchema.parse({ ...valid, status: 'maybe' })).toThrow();
  });
});

describe('eventLiveStatsSchema', () => {
  const valid = {
    event_id: '11111111-1111-1111-1111-111111111111',
    is_live: true,
    updated_at: '2026-06-15T10:00:00.000Z',
  };

  it('parses a valid live-flag row', () => {
    expect(eventLiveStatsSchema.parse(valid)).toEqual(valid);
  });

  it('strips a stray listener_count — dropped column; the count is presence, not a row (#120)', () => {
    expect(eventLiveStatsSchema.parse({ ...valid, listener_count: 3 })).toEqual(valid);
  });

  it('rejects a missing is_live', () => {
    const { is_live: _is_live, ...rest } = valid;
    expect(() => eventLiveStatsSchema.parse(rest)).toThrow();
  });
});

describe('ticketSchema', () => {
  const valid = {
    id: '33333333-3333-3333-3333-333333333333',
    user_id: '22222222-2222-2222-2222-222222222222',
    event_id: '11111111-1111-1111-1111-111111111111',
    stripe_payment_id: 'pi_123',
    qr_token: 'signed.token',
    status: 'paid',
    expires_at: null,
    created_at: '2026-06-16T10:00:00.000Z',
    updated_at: '2026-06-16T10:00:00.000Z',
  };

  it('parses a valid paid ticket', () => {
    expect(ticketSchema.parse(valid)).toEqual(valid);
  });

  it('accepts a pending ticket with null payment id + qr and a seat-hold expiry (#105)', () => {
    expect(() =>
      ticketSchema.parse({
        ...valid,
        status: 'pending',
        stripe_payment_id: null,
        qr_token: null,
        expires_at: '2026-06-16T10:35:00.000Z',
      }),
    ).not.toThrow();
  });

  it('rejects an unknown status', () => {
    expect(() => ticketSchema.parse({ ...valid, status: 'gifted' })).toThrow();
  });
});

describe('attendanceSchema', () => {
  const valid = {
    id: '11111111-1111-1111-1111-111111111111',
    ticket_id: '22222222-2222-2222-2222-222222222222',
    event_id: '33333333-3333-3333-3333-333333333333',
    checked_in_at: '2026-06-16T10:00:00.000Z',
    scanned_by: '44444444-4444-4444-4444-444444444444',
    created_at: '2026-06-16T10:00:00.000Z',
  };
  it('parses a valid attendance row', () => {
    expect(attendanceSchema.parse(valid)).toMatchObject({ ticket_id: valid.ticket_id });
  });
  it('rejects a non-uuid ticket_id', () => {
    // override only ticket_id on an otherwise-valid row so the failure isolates the uuid rule.
    expect(() => attendanceSchema.parse({ ...valid, ticket_id: 'nope' })).toThrow();
  });
});

describe('checkInResultSchema', () => {
  it('parses each verdict, name optional', () => {
    for (const result of ['valid', 'already', 'invalid', 'wrongEvent'] as const) {
      expect(checkInResultSchema.parse({ result }).result).toBe(result);
    }
    expect(checkInResultSchema.parse({ result: 'valid', name: 'marco' }).name).toBe('marco');
    expect(checkInResultSchema.parse({ result: 'already' }).name).toBeUndefined();
  });
  it('rejects an unknown verdict', () => {
    expect(() => checkInResultSchema.parse({ result: 'exploded' })).toThrow();
  });
});

// Mirrors public.event_category / event_tickets.status — the literal list, never a loop over
// the constant: a blanked member narrows the boundary and a loop would not notice.
describe('event vocabularies', () => {
  it('eventCategorySchema is the nine categories, in enum order', () => {
    expect(eventCategorySchema.options).toEqual([
      'business',
      'networking',
      'spiritualita',
      'formazione',
      'musica',
      'arte',
      'benessere',
      'creativi',
      'evoluzione',
    ]);
  });

  it('rejects a category outside the enum, blank included', () => {
    for (const bad of ['sport', 'music', 'cultura', '']) {
      expect(eventCategorySchema.safeParse(bad).success).toBe(false);
    }
  });

  it('ticketStatusSchema is pending → paid → checked_in, or refunded', () => {
    expect(ticketStatusSchema.options).toEqual(['pending', 'paid', 'checked_in', 'refunded']);
    for (const bad of ['cancelled', 'gifted', 'expired', '']) {
      expect(ticketStatusSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('eventCalendarFiltersSchema (#151)', () => {
  it('accepts an empty object — no filter is the default, not an error', () => {
    expect(eventCalendarFiltersSchema.parse({})).toEqual({});
  });

  it('accepts every field together', () => {
    const parsed = eventCalendarFiltersSchema.parse({
      category: 'musica',
      city: 'Bologna',
      dateFrom: '2026-08-23T00:00:00.000Z',
      dateTo: '2026-08-30T23:59:59.999Z',
    });
    expect(parsed.category).toBe('musica');
    expect(parsed.city).toBe('Bologna');
    expect(parsed.dateFrom).toBe('2026-08-23T00:00:00.000Z');
    expect(parsed.dateTo).toBe('2026-08-30T23:59:59.999Z');
  });

  it('rejects a category outside the event enum', () => {
    expect(eventCalendarFiltersSchema.safeParse({ category: 'sport' }).success).toBe(false);
  });

  it('caps city at the events.city column width (120), not profiles.city (80)', () => {
    expect(eventCalendarFiltersSchema.safeParse({ city: 'a'.repeat(120) }).success).toBe(true);
    expect(eventCalendarFiltersSchema.safeParse({ city: 'a'.repeat(121) }).success).toBe(false);
  });

  it('rejects a date bound that is not an ISO datetime', () => {
    expect(eventCalendarFiltersSchema.safeParse({ dateFrom: '2026-08-23' }).success).toBe(false);
    expect(eventCalendarFiltersSchema.safeParse({ dateTo: 'domani' }).success).toBe(false);
  });

  it('isEmptyEventCalendarFilters is true for undefined and for an all-undefined object', () => {
    expect(isEmptyEventCalendarFilters(undefined)).toBe(true);
    expect(isEmptyEventCalendarFilters({})).toBe(true);
    expect(
      isEmptyEventCalendarFilters({
        category: undefined,
        city: undefined,
        dateFrom: undefined,
        dateTo: undefined,
      }),
    ).toBe(true);
  });

  it('isEmptyEventCalendarFilters is false when any single field is set', () => {
    expect(isEmptyEventCalendarFilters({ category: 'arte' })).toBe(false);
    expect(isEmptyEventCalendarFilters({ city: 'Torino' })).toBe(false);
    expect(isEmptyEventCalendarFilters({ dateFrom: '2026-08-23T00:00:00.000Z' })).toBe(false);
    expect(isEmptyEventCalendarFilters({ dateTo: '2026-08-23T00:00:00.000Z' })).toBe(false);
  });
});
