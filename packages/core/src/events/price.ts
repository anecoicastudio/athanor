type Locale = 'it' | 'en';

/**
 * Format minor-unit money (price_cents) as a localized currency string.
 * Pure + deterministic (Intl). The DB stores lowercase ISO codes ('eur').
 *
 * The `toUpperCase()` is cosmetic, not required: ECMA-402 ASCII-uppercases the currency code
 * itself, so 'eur', 'EUR' and 'Eur' all format identically. An earlier version of this comment
 * claimed Intl needs uppercase — it does not, and mutation testing caught the claim by swapping
 * the call for `toLowerCase()` without a single test noticing. That swap is an equivalent mutant,
 * and it is the one still surviving in this file.
 */
export function formatPrice(cents: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'it' ? 'it-IT' : 'en-GB', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}
