import en from './catalogs/en.json';
import it from './catalogs/it.json';

export type Locale = 'it' | 'en';
export type MessageKey = keyof typeof it;

const catalogs: Record<Locale, Record<MessageKey, string>> = { it, en };

// No @types/node in this package; both Metro and Next inline `process.env.NODE_ENV` at build
// time, so this local declaration only satisfies tsc — it never resolves a runtime global.
declare const process: { env: { NODE_ENV?: string } };

/**
 * Translate a key. Pass `vars` to substitute `{name}` placeholders
 * (e.g. t('profile.completeness', locale, { percent: 70 })). Two-arg calls
 * are unaffected — interpolation only runs when `vars` is provided.
 *
 * A missing key returns the key itself and never throws (#113): callers cast server-supplied
 * strings into MessageKey, so the type alone cannot guarantee presence. Loud in dev, silent
 * in production — same degrade shape as tagLabel below.
 */
export function t(key: MessageKey, locale: Locale, vars?: Record<string, string | number>): string {
  const message: string | undefined = catalogs[locale][key];
  if (message === undefined) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[i18n] missing key "${key}" (${locale})`);
    }
    return key;
  }
  if (!vars) return message;
  return message.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

/**
 * Count-aware translate (#634). The catalogs carry no plural machinery, so grammatical
 * number is a KEY choice, decided once as this pattern: a countable key that can render
 * with n === 1 declares a sibling `<key>.one` in BOTH catalogs (the base key stays the
 * plural), and `tn` picks the sibling at n === 1. A key without a `.one` sibling falls
 * back to its base string, so adoption is per-key — «1 eventi» is a bug you fix by
 * adding the sibling, never by branching at the call site. `{n}` is always available
 * to the string without the caller repeating it in `vars`.
 */
export function tn(
  key: MessageKey,
  n: number,
  locale: Locale,
  vars?: Record<string, string | number>,
): string {
  const singular = `${key}.one`;
  const chosen = n === 1 && singular in catalogs[locale] ? (singular as MessageKey) : key;
  return t(chosen, locale, { n, ...vars });
}

/**
 * Label for a curated tag key (`tag.identity.*` / `tag.seeking.*` / `tag.skill.*`).
 *
 * Separate from `t` because the key is DATA here, not a literal: the Momenti deck receives
 * tag keys from `get_momenti_deck()` and localizes them per read (#273 D), so the key cannot
 * be typed as a MessageKey at the call site. An unknown tag returns the key itself — a tag
 * that reaches the DB before the catalogs must read as «astronauta», never «undefined».
 */
export function tagLabel(
  kind: 'identity' | 'seeking' | 'skill' | 'profession',
  tag: string,
  locale: Locale,
): string {
  const key = `tag.${kind}.${tag}`;
  const catalog: Record<string, string | undefined> = catalogs[locale];
  return catalog[key] ?? tag;
}
