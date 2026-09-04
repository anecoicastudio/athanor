import { t, type MessageKey } from '@athanor/i18n';
import type { Locale, Notification } from '@athanor/schemas';

/** The fund templates that interpolate a number, and which param each one needs (#127). */
const FUND_NUMERIC_PARAMS: Record<string, string> = {
  'notif.tpl.fundMilestone': 'pct',
  'notif.tpl.fundAnnounceCountdown': 'days',
  'notif.tpl.fundBallotCountdown': 'days',
};

/**
 * Notification params are raw data interpolated into the notif.tpl.* body — names,
 * counts, titles — EXCEPT the warn template's `reason` (#313), which is a
 * reports.category TOKEN and must render as the member-locale report.reason.* label.
 * Localized here at render (not at enqueue), so the row follows a locale switch like
 * every other string. An unknown token degrades to itself (the tagLabel shape, #113):
 * a category added to the DB before the catalogs must read as a word, never as a key.
 */
export function displayParams(
  n: Pick<Notification, 'template_key' | 'params'>,
  locale: Locale,
): Record<string, string | number> {
  const params = n.params as Record<string, string | number>;
  // #127: a fund broadcast reaches EVERY member at once, so a row that arrives without its
  // numeric param would show «Il fondo ha superato il {pct} % dell'obiettivo.» to all of them —
  // t() leaves an unmatched placeholder in place by design (#113: degrade, never throw). The
  // push mirror already defaults these (_shared/notif-templates.ts); this is the in-app half,
  // which is the one everybody sees.
  const numeric = FUND_NUMERIC_PARAMS[n.template_key];
  if (numeric !== undefined) {
    return { ...params, [numeric]: typeof params[numeric] === 'number' ? params[numeric] : 0 };
  }
  if (n.template_key !== 'notif.tpl.warn') return params;
  const token = typeof params.reason === 'string' ? params.reason : '';
  const key = `report.reason.${token}` as MessageKey;
  const label = t(key, locale);
  return { ...params, reason: label === key ? token : label };
}
