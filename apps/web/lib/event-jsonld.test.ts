import { describe, expect, it } from 'vitest';
import type { PublicEvent } from '@athanor/schemas';
import { eventJsonLd } from './event-jsonld';

const event: PublicEvent = {
  id: '00000000-0000-0000-0000-0000000000e1',
  title: 'Sera di incontri',
  category: 'networking',
  is_online: false,
  venue: 'Casa delle Idee',
  city: 'Milano',
  description: null,
  starts_at: '2026-09-01T16:00:00.000Z',
  ends_at: '2026-09-01T19:00:00.000Z',
  price_cents: 1500,
  currency: 'eur',
  is_athanor_day: false,
  organizer_handle: 'sole',
};

const URL_ = 'https://www.athanor.workers.dev/event/00000000-0000-0000-0000-0000000000e1';

describe('eventJsonLd', () => {
  it('describes a physical event with its place and offer', () => {
    const ld = eventJsonLd(event, URL_);
    expect(ld['@type']).toBe('Event');
    expect(ld.eventAttendanceMode).toBe('https://schema.org/OfflineEventAttendanceMode');
    expect(ld.location).toMatchObject({ '@type': 'Place', name: 'Casa delle Idee' });
    expect(ld.offers).toMatchObject({ price: '15.00', priceCurrency: 'EUR', url: URL_ });
  });

  it('describes an online event as a virtual location pointing at this page', () => {
    // Never the stream_url: the read-model does not carry it, and publishing it would
    // hand a paid online event away for free.
    const ld = eventJsonLd({ ...event, is_online: true, venue: null, city: null }, URL_);
    expect(ld.eventAttendanceMode).toBe('https://schema.org/OnlineEventAttendanceMode');
    expect(ld.location).toEqual({ '@type': 'VirtualLocation', url: URL_ });
  });

  /*
   * venue and city are both nullable in the table, and a Place with no name at all is
   * what Google reads as a malformed event. Fall back through what exists.
   */
  it('names the place from the city when there is no venue', () => {
    const ld = eventJsonLd({ ...event, venue: null }, URL_);
    expect(ld.location).toEqual({ '@type': 'Place', name: 'Milano', address: 'Milano' });
  });

  it('omits the address when there is no city, and still names the venue', () => {
    const ld = eventJsonLd({ ...event, city: null }, URL_);
    expect(ld.location).toEqual({ '@type': 'Place', name: 'Casa delle Idee' });
  });

  it('degrades to an empty place name when the row carries neither', () => {
    const ld = eventJsonLd({ ...event, venue: null, city: null }, URL_);
    expect(ld.location).toEqual({ '@type': 'Place', name: '' });
  });

  it('links the organizer to their public profile, and omits them when private', () => {
    expect(eventJsonLd(event, URL_).organizer).toMatchObject({
      '@type': 'Person',
      url: 'https://www.athanor.workers.dev/@sole',
    });
    expect(eventJsonLd({ ...event, organizer_handle: null }, URL_).organizer).toBeUndefined();
  });

  it('prices a free event at zero rather than dropping the offer', () => {
    expect(eventJsonLd({ ...event, price_cents: 0 }, URL_).offers).toMatchObject({ price: '0.00' });
  });

  it('omits endDate when the event has no end, rather than emitting null', () => {
    const ld = eventJsonLd({ ...event, ends_at: null }, URL_);
    expect(ld.endDate).toBeUndefined();
    expect(JSON.stringify(ld)).not.toContain('endDate');
  });

  /*
   * Google reads this markup; a mismatch between it and the visible page is a
   * structured-data violation. Nothing here may come from a column the page itself
   * does not show.
   */
  it('never emits an unpublished column', () => {
    const serialised = JSON.stringify(eventJsonLd(event, URL_));
    for (const forbidden of ['geo', 'stream_url', 'fee_pct', 'capacity', 'organizer_id']) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});
