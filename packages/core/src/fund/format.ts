/**
 * Format a minor-unit fund total as a grouped whole-euro string («€ 483.281»).
 * Pure + deterministic (Intl, explicit locale). The ticker shows whole euros —
 * cents are truncated. Mirrors core/events/price.ts' Intl precedent.
 */
export function formatFundTotal(cents: number, locale: 'it' | 'en'): string {
  const euros = Math.floor(cents / 100);
  const grouped = new Intl.NumberFormat(locale === 'it' ? 'it-IT' : 'en-GB', {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(euros);
  return `€ ${grouped}`;
}
