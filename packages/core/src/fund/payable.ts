/**
 * The ceiling a realization plan is costed against (#229, FUND-25/FUND-53).
 *
 * `payable` is what can ever reach the winner once the cycle's declared retention is taken:
 * the announcement snapshot (`fund_editions.confirmed_pool_cents`) less `split_pct`. It is
 * DERIVED, never chosen — the same figure `realization_plan_phases_within_payable` caps the
 * phase sum at and `fund_payout_ledger` caps releases at (#244).
 *
 * The arithmetic mirrors the database's `(pool * (100 - split)) / 100` in integer division,
 * which truncates. Rounding here would put the screen's «remaining» one cent above a
 * ceiling the trigger refuses, and the member would meet a refusal the UI told them could
 * not happen.
 */
export function payableCents(poolCents: number, splitPct: number): number {
  return Math.floor((poolCents * (100 - splitPct)) / 100);
}

/**
 * What is still uncosted: the payable less what the plan's phases already promise.
 *
 * Clamped at zero. The database cannot hold an over-costed plan, so a negative remainder
 * can only come from a stale read — and a negative euro figure on a money surface is a
 * worse answer than «nothing left».
 */
export function remainingPayableCents(
  poolCents: number,
  splitPct: number,
  costedCents: number,
): number {
  return Math.max(0, payableCents(poolCents, splitPct) - costedCents);
}
