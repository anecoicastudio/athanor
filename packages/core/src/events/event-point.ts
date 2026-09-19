import type { GeoPoint } from './geo-grid';

/**
 * Where an event's point comes from (#781, ruling 2026-09-19 evening): the typed venue and city,
 * geocoded on the phone by the OS geocoder and snapped to the event grid — with the organiser's own
 * rounded position as the fallback they can choose. Pure; the composer owns the I/O.
 *
 * Two rules carry the ruling, and both are here so a test can hold them:
 *   * the venue is the point only while it still matches what is typed — edit the venue and the old
 *     point is gone, rather than quietly standing in for a place nobody named;
 *   * the phone position is used only when the organiser chose it. It is never the silent answer to
 *     a venue the geocoder could not find: the composer says so and offers it instead (#769's lesson —
 *     a refusal must say something on screen).
 */
export type EventPointSource = 'venue' | 'device';

export type VenueLookup =
  | { state: 'idle'; query: null }
  | { state: 'looking' | 'notFound' | 'failed'; query: string };

export type EventPointStatus = 'empty' | 'looking' | 'venue' | 'device' | 'notFound' | 'failed';

export type VenuePoint = {
  query: string;
  point: GeoPoint;
};

/**
 * What the geocoder is asked: `venue, city`, or the city alone (a city centre is a point too).
 * Null without a city — a venue name alone is ambiguous across cities, and the geocoder would pick
 * one anyway.
 */
export function venueQuery(venue: string, city: string): string | null {
  const town = city.trim();
  if (town.length === 0) return null;
  const place = venue.trim();
  return place.length > 0 ? `${place}, ${town}` : town;
}

/**
 * Whether the text on screen still needs a lookup: something is typed, no point answers it yet,
 * and it is not already being looked up or known not to exist. A failed lookup is retried — a
 * network error is not an answer about the place.
 */
export function shouldLookUpVenue(
  query: string | null,
  venue: VenuePoint | null,
  lookup: VenueLookup,
): boolean {
  if (query === null) return false;
  if (venue?.query === query) return false;
  if (lookup.query === query && (lookup.state === 'looking' || lookup.state === 'notFound')) {
    return false;
  }
  return true;
}

/** The point the event would be saved with right now, and what the composer should say about it. */
export function eventPointState(input: {
  query: string | null;
  venue: VenuePoint | null;
  device: GeoPoint | null;
  source: EventPointSource | null;
  lookup: VenueLookup;
}): { point: GeoPoint | null; status: EventPointStatus } {
  const { query, venue, device, source, lookup } = input;
  if (source === 'venue' && venue !== null && venue.query === query) {
    return { point: venue.point, status: 'venue' };
  }
  if (source === 'device' && device !== null) return { point: device, status: 'device' };
  if (lookup.state !== 'idle' && lookup.query === query)
    return { point: null, status: lookup.state };
  return { point: null, status: 'empty' };
}
