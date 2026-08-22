import { dayBucket } from '@athanor/core';
import { localeTag, t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';

/** Compact relative-time string, localised via `time.*` i18n keys.
 *
 * @param iso      ISO-8601 timestamp string.
 * @param locale   Display locale (`Locale` from `@athanor/schemas`).
 * @param now      Reference epoch ms (default `Date.now()`). Inject in tests / list renders.
 */
export function timeAgo(iso: string, locale: Locale, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return t('time.now', locale);
  if (s < 3600) return t('time.minutes', locale, { n: Math.floor(s / 60) });
  if (s < 86400) return t('time.hours', locale, { n: Math.floor(s / 3600) });
  return t('time.days', locale, { n: Math.floor(s / 86400) });
}

/**
 * Maps an ISO timestamp to a localised day-section header label
 * («Oggi» / «Ieri» / «17 giu») for the ledger SectionList.
 *
 * Uses `dayBucket` from @athanor/core (core/chat/dayBucket — pure, no I/O).
 * The `now` parameter is injectable so callers can pin it across a render for
 * consistency across all rows in the same list pass.
 */
export function ledgerDayLabel(iso: string, locale: Locale, now: Date = new Date()): string {
  const bucket = dayBucket(iso, now);
  if (bucket.kind === 'today') return t('ledger.today', locale);
  if (bucket.kind === 'yesterday') return t('ledger.yesterday', locale);
  // 'date': format the date as a short locale string (e.g. "17 giu" / "Jun 17").
  return new Date(iso).toLocaleDateString(localeTag(locale), {
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Derive a stable day-bucket key (device-local YYYY-MM-DD) from an ISO timestamp.
 * Used as the SectionList section `key` — one section per calendar day.
 */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Full "17 giugno 2026" / "17 June 2026" — renewal dates, payment receipts. */
export function longDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(localeTag(locale), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** "17 giu, 18:00" / "17 Jun, 18:00" — when an event happens, within the current year. */
export function dateTime(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(localeTag(locale), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Same as {@link dateTime} plus the year — the event-create picker, where the
 * chosen date can be far out and the year is not safe to infer. */
export function dateTimeWithYear(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(localeTag(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "giugno 2026" / "June 2026" — calendar section headers. */
export function monthYear(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(localeTag(locale), {
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Parse a Postgres `date` column ('YYYY-MM-DD') as a CALENDAR DAY in the device's zone.
 *
 * `new Date('2026-11-01')` is UTC midnight, which is 31 October west of Greenwich — a phase
 * scheduled for the first of the month would render as the last of the previous one. The
 * parts are read explicitly instead, and the time is set to noon so a DST shift cannot
 * carry the day either way.
 */
export function parseCalendarDay(dateOnly: string): Date {
  const [y, m, d] = dateOnly.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

/** "17 giugno 2026" / "17 June 2026" from a `date` column — the calendar-day counterpart
 *  of {@link longDate}, which takes an instant. */
export function calendarDay(dateOnly: string, locale: Locale): string {
  return parseCalendarDay(dateOnly).toLocaleDateString(localeTag(locale), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
