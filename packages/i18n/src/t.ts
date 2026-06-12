import en from './catalogs/en.json';
import it from './catalogs/it.json';

export type Locale = 'it' | 'en';
export type MessageKey = keyof typeof it;

const catalogs: Record<Locale, Record<MessageKey, string>> = { it, en };

export function t(key: MessageKey, locale: Locale): string {
  return catalogs[locale][key];
}
