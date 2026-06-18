/** Minimum contribution = €1 (PRD §4.11). Named constant, never a scattered literal (rule #10). */
export const MIN_CONTRIBUTION_CENTS = 100;

/**
 * Parse a user-entered euro amount into integer minor units (cents), or null if invalid.
 * Pure + deterministic. Accepts whole euros and ≤2-dp; tolerates the it-IT decimal comma.
 * Returns null below the €1 minimum, on >2 decimals, or on any non-numeric / negative input.
 */
export function parseEuroToCents(input: string | number): number | null {
  const raw = typeof input === 'number' ? String(input) : input.trim();
  if (raw === '') return null;
  // one decimal separator (dot or comma), ≤2 fractional digits, no sign/letters
  if (!/^\d+([.,]\d{1,2})?$/.test(raw)) return null;
  const cents = Math.round(Number(raw.replace(',', '.')) * 100);
  if (!Number.isFinite(cents) || cents < MIN_CONTRIBUTION_CENTS) return null;
  return cents;
}
