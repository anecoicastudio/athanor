/**
 * Parse the event-create price field into integer minor units (cents), or null if the field
 * is not a well-formed amount. Tolerates the it-IT decimal comma.
 *
 * Validation mirrors `parseEuroToCents` in @athanor/core, which cannot be reused directly:
 * that one enforces the €1 fund-contribution minimum of PRD §4.11, while a ticket may be any
 * amount from zero up (`events.price_cents >= 0`).
 *
 * Rejecting rather than coercing matters because `Number` is far more permissive than a price
 * field: without the guard `'1e3'` reads as €1000 and `'1.000,00'` as NaN, since `replace`
 * rewrites only the first separator. `eventCreateSchema` catches the malformed results, but it
 * cannot tell a typo from a deliberate amount — only the field can.
 *
 * NOTE: dormant at runtime. `event-create.tsx` returns early for any paid event (the PRD §4.13
 * identity gate is deferred), so nothing reaches this yet. It goes live with that gate — which
 * is exactly when a coerced price would start minting real charges.
 */
export function parsePriceCents(price: string): number | null {
  const raw = price.trim();
  if (raw === '') return null;
  // one decimal separator (dot or comma), ≤2 fractional digits, no sign, no exponent
  if (!/^\d+([.,]\d{1,2})?$/.test(raw)) return null;
  const [euros, cents = ''] = raw.replace(',', '.').split('.');
  // Composed from the digits rather than multiplied by 100: 1.005 * 100 is 100.4999… in binary
  // floating point, so Math.round would silently drop a cent.
  return Number(euros) * 100 + Number(cents.padEnd(2, '0'));
}
