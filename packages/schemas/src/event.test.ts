import { describe, expect, it } from 'vitest';
import { eventCreateSchema, eventNearbySchema, eventSchema } from './event';

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
