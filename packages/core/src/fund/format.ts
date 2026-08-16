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

/**
 * Format a minor-unit amount to the cent («1.234,56»), without a currency symbol — the
 * catalog owns where the € sits, because IT writes «1,27€» and EN writes «€1.27».
 *
 * Separate from formatFundTotal, which truncates: the ticker is a headline, but the fee
 * coverage on the disclosure screen (#236) is €0,27 and truncation would show it as «0».
 * A payment figure is shown to the cent or it is not shown.
 */
export function formatEuroAmount(cents: number, locale: 'it' | 'en'): string {
  return new Intl.NumberFormat(locale === 'it' ? 'it-IT' : 'en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(cents / 100);
}
