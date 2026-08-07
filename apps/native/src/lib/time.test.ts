import { describe, expect, it } from 'vitest';
import { dayKey, ledgerDayLabel, localeTag, shortDate, timeAgo } from './time';

// Fixed reference instant so every relative computation is deterministic.
const NOW = new Date('2026-06-17T12:00:00').getTime();
const isoAgo = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

describe('localeTag', () => {
  it('maps both locales to their BCP-47 tag', () => {
    expect(localeTag('it')).toBe('it-IT');
    expect(localeTag('en')).toBe('en-GB');
  });
});

describe('timeAgo', () => {
  it('under 60s → "now" in both locales', () => {
    expect(timeAgo(isoAgo(0), 'en', NOW)).toBe('now');
    expect(timeAgo(isoAgo(59), 'en', NOW)).toBe('now');
    expect(timeAgo(isoAgo(59), 'it', NOW)).toBe('ora');
  });

  it('future timestamps clamp to "now"', () => {
    expect(timeAgo(isoAgo(-120), 'en', NOW)).toBe('now');
  });

  it('minutes', () => {
    expect(timeAgo(isoAgo(60), 'en', NOW)).toBe('1m');
    expect(timeAgo(isoAgo(5 * 60 + 30), 'en', NOW)).toBe('5m');
    expect(timeAgo(isoAgo(59 * 60), 'it', NOW)).toBe('59m');
  });

  it('hours', () => {
    expect(timeAgo(isoAgo(3600), 'en', NOW)).toBe('1h');
    expect(timeAgo(isoAgo(23 * 3600), 'it', NOW)).toBe('23h');
  });

  it('days — locale-specific suffix', () => {
    expect(timeAgo(isoAgo(86400), 'en', NOW)).toBe('1d');
    expect(timeAgo(isoAgo(2 * 86400), 'it', NOW)).toBe('2g');
  });
});

describe('ledgerDayLabel', () => {
  const now = new Date('2026-06-17T12:00:00');

  it('today', () => {
    expect(ledgerDayLabel('2026-06-17T08:00:00', 'en', now)).toBe('Today');
    expect(ledgerDayLabel('2026-06-17T08:00:00', 'it', now)).toBe('Oggi');
  });

  it('yesterday (injected now)', () => {
    expect(ledgerDayLabel('2026-06-16T23:59:00', 'en', now)).toBe('Yesterday');
    expect(ledgerDayLabel('2026-06-16T00:00:01', 'it', now)).toBe('Ieri');
  });

  it('older date → short "day month" label', () => {
    const en = ledgerDayLabel('2026-06-01T12:00:00', 'en', now);
    const it = ledgerDayLabel('2026-06-01T12:00:00', 'it', now);
    expect(en).toMatch(/^1\s\p{L}+$/u); // "1 Jun"
    expect(it).toMatch(/^1\s\p{L}+$/u); // "1 giu"
    expect(en).not.toBe(it); // locale actually applied
  });
});

describe('dayKey', () => {
  it('zero-pads month and day', () => {
    expect(dayKey('2026-01-05T12:00:00')).toBe('2026-01-05');
  });

  it('two-digit month/day pass through', () => {
    expect(dayKey('2026-11-23T00:30:00')).toBe('2026-11-23');
  });
});

describe('shortDate', () => {
  it('renders a "day month" shape per locale', () => {
    expect(shortDate('2026-06-17T12:00:00', 'en')).toMatch(/^17\s\p{L}+$/u);
    expect(shortDate('2026-06-17T12:00:00', 'it')).toMatch(/^17\s\p{L}+$/u);
  });
});
