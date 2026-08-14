import { listState } from './list-state';

/**
 * Which of the four things a fund surface can be showing about the active cycle (issue #224,
 * FUND-47: «the counter has a defined state before any cycle exists»).
 *
 * At launch production carries no `fund_editions` row, so every fund surface sits in the
 * no-cycle state — and that state is an ANNOUNCEMENT («Il primo ciclo aprirà presto»), never
 * an absence, never €0, never an empty ticker (FUND-SPEC §6: the surfaces render the no-active-
 * cycle state by design). Two claims this module keeps apart, each already paid for once:
 *
 * 1. The announcement may only be made once the read settled successfully on nothing. A query
 *    still in flight is `pending` — the announcement must not flash while the answer is on its
 *    way — and a failed read is `error`, because «the first cycle will open soon» asserted on
 *    the strength of a network error is the same false-claim shape as #111's «Non hai bloccato
 *    nessuno».
 * 2. A cached edition outranks a failed refetch (`staleWins: true`): the fund heartbeat is
 *    list-shaped public data, not a member's own Aura, and blanking a live countdown over a
 *    refetch blip would be worse than showing it a minute stale.
 *
 * Extracted from the .tsx for the same reason as `topWaitingMomento` (`lib/momenti-home.ts`):
 * this app's vitest harness is `environment: 'node'` with an `src/**\/*.test.ts` glob, so a
 * rule left inside a component is structurally unassertable. The per-surface maps below are
 * the render tests' subject — the components stay thin switches over their output.
 */
export type FundCycleState = 'pending' | 'error' | 'noCycle' | 'active';

export function fundCycleState({
  status,
  fetchStatus,
  edition,
}: {
  /** `query.status` from the `fundKeys.activeEdition()` query. */
  status: 'pending' | 'error' | 'success';
  /** `query.fetchStatus` — distinguishes idle/paused from in flight (see `listState`). */
  fetchStatus: 'fetching' | 'paused' | 'idle';
  /** `query.data` — the active edition, `null` on a settled empty read. */
  edition: unknown;
}): FundCycleState {
  const state = listState({ status, fetchStatus, isEmpty: edition == null, staleWins: true });
  switch (state) {
    case 'idle':
    case 'loading':
      return 'pending';
    case 'error':
      return 'error';
    case 'empty':
      return 'noCycle';
    case 'ready':
      return 'active';
  }
}

/**
 * The Home «Dai Vita al Tuo Sogno» slot (`DreamHeroCard`).
 *
 * `pending` and `error` COLLAPSE (DESIGN §11 2026-08-12 rule b): the fund heartbeat is not a
 * claim about the member, so an absent block asserts nothing and the owning surface —
 * `(modal)/annual` — keeps the error state and the retry for whoever goes looking. `noCycle`
 * renders the announcement card: the fund is a SHIPPED feature, so «Presto qui» over it became
 * a false claim the moment M7 landed — the honest state is the first cycle's announcement,
 * which is #224 replacing the `ComingSoonSection` fallback.
 */
export type DreamHeroSlot = 'collapse' | 'announce' | 'card';

export function dreamHeroSlot(state: FundCycleState): DreamHeroSlot {
  switch (state) {
    case 'pending':
    case 'error':
      return 'collapse';
    case 'noCycle':
      return 'announce';
    case 'active':
      return 'card';
  }
}

/**
 * The fund modal (`(modal)/annual.tsx`) body. Unlike the Home slot it is the owning surface,
 * so nothing collapses: `error` renders the retry (a modal someone opened must answer), and
 * `announce` is the full forward-looking composition — hero quote + the ticker's own no-cycle
 * card, never a €0 ticker and never the old «nessuna edizione» absence line.
 */
export type AnnualFundBody = 'loading' | 'error' | 'announce' | 'live';

export function annualFundBody(state: FundCycleState): AnnualFundBody {
  switch (state) {
    case 'pending':
      return 'loading';
    case 'error':
      return 'error';
    case 'noCycle':
      return 'announce';
    case 'active':
      return 'live';
  }
}
