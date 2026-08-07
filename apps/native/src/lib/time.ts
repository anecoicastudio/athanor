import { dayBucket } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';

/**
 * BCP-47 tag for `toLocaleDateString` — the single home for the it-IT/en-GB
 * mapping previously hand-rolled at four call sites.
 */
export function localeTag(locale: Locale): 'it-IT' | 'en-GB' {
  return locale === 'it' ? 'it-IT' : 'en-GB';
}

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

/** Short "17 giu" / "Jun 17" day+month label (star grant dates, receipts). */
export function shortDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(localeTag(locale), {
    day: 'numeric',
    month: 'short',
  });
}
