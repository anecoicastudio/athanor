import en from './catalogs/en.json';
import it from './catalogs/it.json';

export type Locale = 'it' | 'en';
export type MessageKey = keyof typeof it;

const catalogs: Record<Locale, Record<MessageKey, string>> = { it, en };

/**
 * Translate a key. Pass `vars` to substitute `{name}` placeholders
 * (e.g. t('profile.completeness', locale, { percent: 70 })). Two-arg calls
 * are unaffected — interpolation only runs when `vars` is provided.
 */
export function t(key: MessageKey, locale: Locale, vars?: Record<string, string | number>): string {
  const message = catalogs[locale][key];
  if (!vars) return message;
  return message.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

/**
 * Label for an onboarding tag key (`tag.identity.*` / `tag.seeking.*`).
 *
 * Separate from `t` because the key is DATA here, not a literal: the Momenti deck receives
 * tag keys from `get_momenti_deck()` and localizes them per read (#273 D), so the key cannot
 * be typed as a MessageKey at the call site. An unknown tag returns the key itself — a tag
 * that reaches the DB before the catalogs must read as «astronauta», never «undefined».
 */
export function tagLabel(kind: 'identity' | 'seeking', tag: string, locale: Locale): string {
  const key = `tag.${kind}.${tag}`;
  const catalog: Record<string, string | undefined> = catalogs[locale];
  return catalog[key] ?? tag;
}
