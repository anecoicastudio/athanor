/**
 * Which of the five things a list-backed surface can be showing (issue #111).
 *
 * Eleven screens used to derive their empty state from `!isLoading` or `data ?? []`, so a
 * failed read and "you genuinely have nothing" were the same pixels — and the copy asserted
 * the second. On `blocked.tsx` that made a network error say «Non hai bloccato nessuno», a
 * false all-clear on a safety surface; on `AnalyticsLiteCard` it told a paying Circle member
 * the feature was not built yet.
 *
 * Three arms exist because three claims are being kept apart, and each was paid for once:
 *
 * 1. `empty` is a claim ABOUT THE DATA and may only be made once a read settled successfully.
 *    Everything else — pending, disabled, thrown — is the absence of an answer, not an answer.
 * 2. `idle` is separate from `loading` because TanStack v5's `isLoading` is `isPending &&
 *    isFetching`: a query with `enabled: !!userId` reports `isLoading: false` with no data
 *    while the session hydrates, which is exactly the hole #10 found in the Aura surfaces.
 *    Only the `status`/`fetchStatus` pair distinguishes "not started" from "in flight".
 * 3. Content in hand outranks a spinner always, and outranks an *error* only when the caller
 *    says so — see `staleWins`.
 *
 * `isEmpty` is the caller's, not ours, because the shape differs per screen — `rows.length ===
 * 0` on a flat query, `data?.pages.flatMap(...)` on an infinite one, `card == null` on a
 * detail screen, `weekRecapIsEmpty(recap)` on the Home week slot. What must NOT differ is what
 * that emptiness is allowed to mean.
 *
 * This subsumes `weekSlotState` (#279, issue #100), whose docblock asked for exactly that:
 * "#111 will likely extract a shared list-state component — this is written to be lifted."
 * Its four states map on: `pending` → `loading` | `idle`, `data` → `ready`.
 */
export type ListState = 'idle' | 'loading' | 'error' | 'empty' | 'ready';

export function listState({
  status,
  fetchStatus,
  isEmpty,
  staleWins,
}: {
  /** `query.status` — pending until the first settle, then error or success. */
  status: 'pending' | 'error' | 'success';
  /** `query.fetchStatus` — `idle` on a disabled query, `paused` when offline. */
  fetchStatus: 'fetching' | 'paused' | 'idle';
  /** Caller-derived: does the query's data amount to nothing to render? */
  isEmpty: boolean;
  /**
   * When a refetch fails over cached content, does the content stay?
   *
   * The one axis the app's two prior answers disagreed on, and both were deliberate.
   * `MomentiCard.tsx:41-44` draws the line: *a stale Aura number is a claim about a person's
   * worth, a stale proposal costs one wasted tap.*
   *
   * - `true` for lists — blanking rows the member is reading is worse than showing them a
   *   minute stale, and the destination screen can always refresh.
   * - `false` for anything reporting the member's own Aura. The query client persists to
   *   AsyncStorage with a 24h `gcTime` and Aura decays, so yesterday's number presented as
   *   today's is the false confidence `aura-display.ts` already refused for the score.
   *
   * Required rather than defaulted: a caller that has not thought about it should not
   * silently inherit either answer.
   */
  staleWins: boolean;
}): ListState {
  // Content outranks a spinner unconditionally; whether it outranks an error is the caller's.
  if (!isEmpty && (staleWins || status !== 'error')) return 'ready';
  if (status === 'error') return 'error';
  // `paused` is offline-with-intent: the read has neither failed nor returned nothing, so it
  // is still loading. Saying either of the other two here would be a false claim.
  if (status === 'pending') return fetchStatus === 'idle' ? 'idle' : 'loading';
  return 'empty';
}
