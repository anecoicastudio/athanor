import { describe, expect, it } from 'vitest';
import { localeTag } from '@athanor/i18n';
import {
  calendarDay,
  dateTime,
  dateTimeWithYear,
  dayKey,
  ledgerDayLabel,
  longDate,
  monthYear,
  parseCalendarDay,
  timeAgo,
} from './time';

// Fixed reference instant so every relative computation is deterministic.
const NOW = new Date('2026-06-17T12:00:00').getTime();
const isoAgo = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

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

describe('longDate', () => {
  const iso = '2026-06-17T12:00:00';

  it('renders "day month year" with a spelled-out month', () => {
    expect(longDate(iso, 'en')).toMatch(/^17\s\p{L}+\s2026$/u);
    expect(longDate(iso, 'it')).toMatch(/^17\s\p{L}+\s2026$/u);
  });

  it('the month name is actually localised', () => {
    expect(longDate(iso, 'en')).not.toBe(longDate(iso, 'it'));
  });

  // Coupled to the June fixture: "June" clears 4 letters, its abbreviation "Jun" does not.
  // A month whose short form is already ≥4 letters would not distinguish the two.
  it('spells the month out rather than abbreviating it', () => {
    expect(longDate(iso, 'en')).toMatch(/\p{L}{4,}/u);
  });

  it('carries no time-of-day', () => {
    expect(longDate(iso, 'en')).not.toMatch(/\d{1,2}:\d{2}/);
  });
});

describe('dateTime', () => {
  const iso = '2026-06-17T18:30:00';

  it('carries day, month and a 24h clock time', () => {
    expect(dateTime(iso, 'it')).toMatch(/17/);
    expect(dateTime(iso, 'it')).toMatch(/18:30/);
    expect(dateTime(iso, 'en')).toMatch(/18:30/);
  });

  it('omits the year — event detail assumes the current one', () => {
    expect(dateTime(iso, 'it')).not.toContain('2026');
    expect(dateTime(iso, 'en')).not.toContain('2026');
  });

  it('is locale-aware', () => {
    expect(dateTime(iso, 'en')).not.toBe(dateTime(iso, 'it'));
  });
});

describe('dateTimeWithYear', () => {
  const iso = '2026-06-17T18:30:00';

  it('is dateTime plus the year', () => {
    expect(dateTimeWithYear(iso, 'it')).toContain('2026');
    expect(dateTimeWithYear(iso, 'it')).toMatch(/18:30/);
    expect(dateTimeWithYear(iso, 'en')).toContain('2026');
  });

  it('is strictly longer than the year-less form', () => {
    expect(dateTimeWithYear(iso, 'it').length).toBeGreaterThan(dateTime(iso, 'it').length);
  });

  it('a Date round-tripped through toISOString formats identically', () => {
    // event-create holds a Date, not an ISO string; the round trip must not shift it.
    const d = new Date(iso);
    expect(dateTimeWithYear(d.toISOString(), 'it')).toBe(
      d.toLocaleString(localeTag('it'), {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    );
  });
});

describe('monthYear', () => {
  const iso = '2026-06-17T12:00:00';

  it('renders "month year" with no day', () => {
    expect(monthYear(iso, 'en')).toMatch(/^\p{L}+\s2026$/u);
    expect(monthYear(iso, 'it')).toMatch(/^\p{L}+\s2026$/u);
  });

  it('is locale-aware', () => {
    expect(monthYear(iso, 'en')).not.toBe(monthYear(iso, 'it'));
  });

  it('groups every day of a month under one key', () => {
    const first = monthYear('2026-06-01T00:00:00', 'it');
    const last = monthYear('2026-06-30T23:59:00', 'it');
    expect(first).toBe(last);
  });

  it('separates the same month across different years', () => {
    expect(monthYear('2026-06-17T12:00:00', 'it')).not.toBe(monthYear('2027-06-17T12:00:00', 'it'));
  });
});

describe('parseCalendarDay / calendarDay', () => {
  it('reads a date column as the calendar day it names, not as UTC midnight', () => {
    const d = parseCalendarDay('2026-11-01');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(10);
    expect(d.getDate()).toBe(1);
  });

  it('round-trips through dayKey — what is shown is what is stored', () => {
    expect(dayKey(parseCalendarDay('2026-03-29').toISOString())).toBe('2026-03-29');
    expect(dayKey(parseCalendarDay('2026-01-01').toISOString())).toBe('2026-01-01');
  });

  it('renders the long date in both catalogs', () => {
    expect(calendarDay('2026-06-17', 'it')).toBe('17 giugno 2026');
    expect(calendarDay('2026-06-17', 'en')).toBe('17 June 2026');
  });
});
