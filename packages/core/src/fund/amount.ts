import { MIN_CONTRIBUTION_CENTS } from '@athanor/schemas';

/**
 * The €1 minimum (PRD §4.11) is DECLARED in `@athanor/schemas` and re-exported here.
 *
 * Not a second home: schemas is the leaf of the dependency graph, so the schema that validates
 * the amount can own the bound while core still reads it. Every existing `@athanor/core` caller
 * keeps its import path (#387).
 */
export { MIN_CONTRIBUTION_CENTS };

/**
 * Parse a user-entered euro amount into integer minor units (cents), or null if invalid.
 * Pure + deterministic. Accepts whole euros and ≤2-dp; tolerates the it-IT decimal comma.
 * Returns null on >2 decimals, on any non-numeric / negative input, or below `minCents`.
 *
 * `minCents` defaults to the fund's €1 floor and is named explicitly by callers that have a
 * different one — a ticket may be free (`events.price_cents >= 0`), a contribution may not.
 * Expressing that divergence used to cost a byte-identical copy of this regex, since deleted.
 *
 * Rejecting rather than coercing is the point: `Number` is far more permissive than a money
 * field, so without the regex `'1e3'` reads as €1000 and `'1.000,00'` as NaN (`replace`
 * rewrites only the first separator). A schema downstream catches the malformed result but
 * cannot tell a typo from a deliberate amount — only the field can.
 */
export function parseEuroToCents(
  input: string | number,
  minCents: number = MIN_CONTRIBUTION_CENTS,
): number | null {
  const raw = typeof input === 'number' ? String(input) : input.trim();
  // Redundant with the regex below (`^\d+…` rejects '' anyway), kept as an explicit early exit.
  // Both are therefore an equivalent mutant apiece — no test can distinguish them.
  if (raw === '') return null;
  // one decimal separator (dot or comma), ≤2 fractional digits, no sign/letters
  if (!/^\d+([.,]\d{1,2})?$/.test(raw)) return null;
  const cents = Math.round(Number(raw.replace(',', '.')) * 100);
  if (!Number.isFinite(cents) || cents < minCents) return null;
  return cents;
}

/**
 * Parse whole euros into cents, or null unless the input is a plain positive integer.
 *
 * A separate parser, not `parseEuroToCents` with a floor: candidacy budgets are integer by
 * COPY CONTRACT — the catalogs promise «numeri interi» (`candidacy.budget.hint`) — so accepting
 * €1,50 would make the hint a lie rather than merely widen a range.
 *
 * Strictly positive, and that floor is the field's own: it is deliberately not
 * MIN_CONTRIBUTION_CENTS, so raising the fund's minimum must not move a budget's.
 */
export function parseEuroIntegerToCents(input: string): number | null {
  const raw = input.trim();
  if (!/^\d+$/.test(raw)) return null;
  const euros = Number(raw);
  return euros > 0 ? euros * 100 : null;
}
