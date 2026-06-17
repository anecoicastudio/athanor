import { t } from '@athanor/i18n';
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
