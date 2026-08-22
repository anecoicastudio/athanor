import { localeTag, type Locale } from '@athanor/i18n';

/**
 * The zone every public event time is printed in.
 *
 * Not the runtime's zone: this page prerenders on a Worker (UTC) and hydrates in the
 * reader's browser (any zone), so a local-zone format would print two different times
 * for one piece of HTML. Pinning is also the truer statement — an 18:00 event in Milan
 * is at 18:00 regardless of who is reading the link. The zone name is always shown so a
 * reader elsewhere is not left guessing.
 *
 * A per-event zone (derived from the venue) is the eventual right answer; it needs a
 * column that does not exist, and Athanor's events are Italian today.
 */
export const EVENT_TIME_ZONE = 'Europe/Rome';

/** "1 set 2026, 18:00 CEST" / "1 Sep 2026, 18:00 CEST". */
export function eventDateTime(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(localeTag(locale), {
    day: 'numeric',
    month: 'short',
    // Always the year: a shared link outlives the year it was posted.
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: EVENT_TIME_ZONE,
    timeZoneName: 'short',
  });
}

/**
 * Minor units → a localised currency string, or null when the event is free. Null rather
 * than a "free" string so the wording stays in @athanor/i18n (rule 5).
 */
export function eventPrice(priceCents: number, currency: string, locale: Locale): string | null {
  if (priceCents <= 0) return null;
  return new Intl.NumberFormat(localeTag(locale), {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(priceCents / 100);
}

/**
 * Whether the event is over. `now` is injected so the page can compute it once on the
 * server and pass it down — computing it again during hydration would let a page rendered
 * either side of the end time disagree with itself.
 */
export function eventIsPast(
  startsAt: string,
  endsAt: string | null,
  now: number = Date.now(),
): boolean {
  return new Date(endsAt ?? startsAt).getTime() < now;
}
