type Locale = 'it' | 'en';

/**
 * Format minor-unit money (price_cents) as a localized currency string.
 * Pure + deterministic (Intl). The DB stores lowercase ISO codes ('eur'); Intl needs uppercase.
 */
export function formatPrice(cents: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'it' ? 'it-IT' : 'en-GB', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}
