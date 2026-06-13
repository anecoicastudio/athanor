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
