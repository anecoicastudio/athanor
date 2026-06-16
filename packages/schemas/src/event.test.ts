import { describe, expect, it } from 'vitest';
import {
  eventCreateSchema,
  eventLiveStatsSchema,
  eventNearbySchema,
  eventSchema,
  rsvpSchema,
  rsvpStatusSchema,
  ticketSchema,
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
  is_kairos_day: false,
  is_athanor_day: false,
  cover_url: null,
  live_started_at: null,
  live_ended_at: null,
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
  it('rejects a physical event without coordinates', () => {
    expect(() => eventCreateSchema.parse({ ...physical, lat: null, long: null })).toThrow();
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
    listener_count: 142,
    is_live: true,
    updated_at: '2026-06-15T10:00:00.000Z',
  };

  it('parses a valid live-stats row', () => {
    expect(eventLiveStatsSchema.parse(valid)).toEqual(valid);
  });

  it('rejects a negative listener_count', () => {
    expect(() => eventLiveStatsSchema.parse({ ...valid, listener_count: -1 })).toThrow();
  });

  it('rejects a non-integer listener_count', () => {
    expect(() => eventLiveStatsSchema.parse({ ...valid, listener_count: 1.5 })).toThrow();
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
    created_at: '2026-06-16T10:00:00.000Z',
    updated_at: '2026-06-16T10:00:00.000Z',
  };

  it('parses a valid paid ticket', () => {
    expect(ticketSchema.parse(valid)).toEqual(valid);
  });

  it('accepts a pending ticket with null payment id + qr', () => {
    expect(() =>
      ticketSchema.parse({ ...valid, status: 'pending', stripe_payment_id: null, qr_token: null }),
    ).not.toThrow();
  });

  it('rejects an unknown status', () => {
    expect(() => ticketSchema.parse({ ...valid, status: 'gifted' })).toThrow();
  });
});
