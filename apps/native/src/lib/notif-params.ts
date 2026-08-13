import { t, type MessageKey } from '@athanor/i18n';
import type { Locale, Notification } from '@athanor/schemas';

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
  if (n.template_key !== 'notif.tpl.warn') return params;
  const token = typeof params.reason === 'string' ? params.reason : '';
  const key = `report.reason.${token}` as MessageKey;
  const label = t(key, locale);
  return { ...params, reason: label === key ? token : label };
}
