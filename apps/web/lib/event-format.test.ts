import { describe, expect, it } from 'vitest';
import { EVENT_TIME_ZONE, eventDateTime, eventIsPast, eventPrice } from './event-format';

const SEPT_EVENING = '2026-09-01T16:00:00.000Z'; // 18:00 in Rome (CEST)
const JAN_EVENING = '2026-01-08T17:00:00.000Z'; // 18:00 in Rome (CET)

describe('eventDateTime', () => {
  /*
   * The page prerenders on a Worker (UTC) and hydrates in the reader's browser (any
   * zone). Formatting in the runtime's local zone would print two different times for
   * the same HTML and trip a hydration mismatch. Pinning the event's own zone is also
   * the truer statement: an 18:00 event in Milan is at 18:00 whoever is reading.
   */
  it('formats in the event zone, not the runtime zone', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(eventDateTime(SEPT_EVENING, 'it')).toContain('18:00');
    } finally {
      process.env.TZ = previous;
    }
  });

  it('names the zone, so a reader elsewhere is not left guessing', () => {
    expect(eventDateTime(SEPT_EVENING, 'it')).toMatch(/CEST|GMT\+2/);
    expect(eventDateTime(JAN_EVENING, 'it')).toMatch(/CET|GMT\+1/);
  });

  it('carries the year — a shared link outlives the year it was posted', () => {
    expect(eventDateTime(SEPT_EVENING, 'it')).toContain('2026');
  });

  it('follows the locale', () => {
    expect(eventDateTime(SEPT_EVENING, 'it')).toMatch(/set/i);
    expect(eventDateTime(SEPT_EVENING, 'en')).toMatch(/sep/i);
  });

  it('exports the zone it pins, so the page and the tests agree on one value', () => {
    expect(EVENT_TIME_ZONE).toBe('Europe/Rome');
  });
});

describe('eventPrice', () => {
  it('formats minor units as currency in the locale', () => {
    const it = eventPrice(1500, 'eur', 'it');
    expect(it).toContain('15');
    expect(it).toContain('€');
    expect(eventPrice(1500, 'eur', 'en')).toContain('€');
  });

  it('returns null for a free event, leaving the wording to i18n', () => {
    expect(eventPrice(0, 'eur', 'it')).toBeNull();
  });

  it('handles a non-eur currency', () => {
    expect(eventPrice(2000, 'gbp', 'en')).toContain('£');
  });
});

describe('eventIsPast', () => {
  const now = Date.parse('2026-09-01T20:00:00.000Z');

  it('uses the end when there is one', () => {
    expect(eventIsPast(SEPT_EVENING, '2026-09-01T19:00:00.000Z', now)).toBe(true);
    expect(eventIsPast(SEPT_EVENING, '2026-09-01T21:00:00.000Z', now)).toBe(false);
  });

  it('falls back to the start when the event has no end', () => {
    expect(eventIsPast(SEPT_EVENING, null, now)).toBe(true);
    expect(eventIsPast('2026-09-02T16:00:00.000Z', null, now)).toBe(false);
  });
});
