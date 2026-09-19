import { describe, expect, it } from 'vitest';
import { eventPointState, shouldLookUpVenue, venueQuery } from './event-point';

const MILANO = { lat: 45.475, lng: 9.2 };
const PHONE = { lat: 52.5, lng: 13.45 };
const idle = { state: 'idle', query: null } as const;

describe('venueQuery', () => {
  it('joins the venue and the city, trimmed, venue first', () => {
    expect(venueQuery('  Cascina Cuccagna ', ' Milano ')).toBe('Cascina Cuccagna, Milano');
  });

  it('is the city alone when no venue is typed — a city centre is a point too', () => {
    expect(venueQuery('   ', 'Milano')).toBe('Milano');
  });

  it('is null for a venue with no city — a name alone is ambiguous across cities', () => {
    expect(venueQuery('Cascina Cuccagna', '  ')).toBeNull();
  });

  it('is null when neither is typed — there is nothing to look up', () => {
    expect(venueQuery(' ', '  ')).toBeNull();
  });
});

describe('shouldLookUpVenue', () => {
  it('looks up a query nothing has resolved yet', () => {
    expect(shouldLookUpVenue('Milano', null, idle)).toBe(true);
  });

  it('does not look up an empty form', () => {
    expect(shouldLookUpVenue(null, null, idle)).toBe(false);
  });

  it('does not look up again the query that already has a point', () => {
    expect(shouldLookUpVenue('Milano', { query: 'Milano', point: MILANO }, idle)).toBe(false);
  });

  it('looks up again once the query changed from the one that has a point', () => {
    expect(shouldLookUpVenue('Bergamo', { query: 'Milano', point: MILANO }, idle)).toBe(true);
  });

  it('does not start a second lookup of the query already being looked up', () => {
    expect(shouldLookUpVenue('Milano', null, { state: 'looking', query: 'Milano' })).toBe(false);
  });

  it('does not retry on its own a query the geocoder already could not find', () => {
    expect(shouldLookUpVenue('Xyzzy', null, { state: 'notFound', query: 'Xyzzy' })).toBe(false);
  });

  it('does retry a query whose lookup failed — a network error is not an answer', () => {
    expect(shouldLookUpVenue('Milano', null, { state: 'failed', query: 'Milano' })).toBe(true);
  });

  it('looks up a new query even while an older one is still in flight', () => {
    expect(shouldLookUpVenue('Bergamo', null, { state: 'looking', query: 'Milano' })).toBe(true);
  });
});

describe('eventPointState', () => {
  it('uses the venue point when the venue is the source and still matches what is typed', () => {
    expect(
      eventPointState({
        query: 'Milano',
        venue: { query: 'Milano', point: MILANO },
        device: PHONE,
        source: 'venue',
        lookup: idle,
      }),
    ).toEqual({ point: MILANO, status: 'venue' });
  });

  it('never falls back to the phone silently once the venue text has moved on', () => {
    expect(
      eventPointState({
        query: 'Bergamo',
        venue: { query: 'Milano', point: MILANO },
        device: PHONE,
        source: 'venue',
        lookup: idle,
      }),
    ).toEqual({ point: null, status: 'empty' });
  });

  it('uses the phone position when the organiser chose it', () => {
    expect(
      eventPointState({
        query: 'Milano',
        venue: { query: 'Milano', point: MILANO },
        device: PHONE,
        source: 'device',
        lookup: idle,
      }),
    ).toEqual({ point: PHONE, status: 'device' });
  });

  it('keeps the chosen phone position while a venue the geocoder cannot find is typed', () => {
    expect(
      eventPointState({
        query: 'Xyzzy',
        venue: null,
        device: PHONE,
        source: 'device',
        lookup: { state: 'notFound', query: 'Xyzzy' },
      }),
    ).toEqual({ point: PHONE, status: 'device' });
  });

  it('has no point when the phone was chosen but never answered', () => {
    expect(
      eventPointState({ query: null, venue: null, device: null, source: 'device', lookup: idle }),
    ).toEqual({ point: null, status: 'empty' });
  });

  it('reports a lookup in flight for the query on screen', () => {
    expect(
      eventPointState({
        query: 'Milano',
        venue: null,
        device: null,
        source: null,
        lookup: { state: 'looking', query: 'Milano' },
      }),
    ).toEqual({ point: null, status: 'looking' });
  });

  it('reports a query the geocoder could not find', () => {
    expect(
      eventPointState({
        query: 'Xyzzy',
        venue: null,
        device: null,
        source: null,
        lookup: { state: 'notFound', query: 'Xyzzy' },
      }),
    ).toEqual({ point: null, status: 'notFound' });
  });

  it('reports a lookup that failed', () => {
    expect(
      eventPointState({
        query: 'Milano',
        venue: null,
        device: null,
        source: null,
        lookup: { state: 'failed', query: 'Milano' },
      }),
    ).toEqual({ point: null, status: 'failed' });
  });

  it('forgets a lookup outcome that belongs to text no longer on screen', () => {
    expect(
      eventPointState({
        query: 'Bergamo',
        venue: null,
        device: null,
        source: null,
        lookup: { state: 'notFound', query: 'Milano' },
      }),
    ).toEqual({ point: null, status: 'empty' });
  });

  it('is empty on an untouched form', () => {
    expect(
      eventPointState({ query: null, venue: null, device: null, source: null, lookup: idle }),
    ).toEqual({ point: null, status: 'empty' });
  });

  it('has no point when the venue is the source but no venue point exists yet', () => {
    expect(
      eventPointState({
        query: 'Milano',
        venue: null,
        device: PHONE,
        source: 'venue',
        lookup: idle,
      }),
    ).toEqual({ point: null, status: 'empty' });
  });

  it('does not use a venue point that was never chosen as the source', () => {
    expect(
      eventPointState({
        query: 'Milano',
        venue: { query: 'Milano', point: MILANO },
        device: null,
        source: null,
        lookup: idle,
      }),
    ).toEqual({ point: null, status: 'empty' });
  });
});
