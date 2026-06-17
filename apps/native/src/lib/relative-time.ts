import { dayBucket } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';

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
  return new Date(iso).toLocaleDateString(locale === 'it' ? 'it-IT' : 'en-GB', {
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
