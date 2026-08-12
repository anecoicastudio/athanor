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
 * 3. Rows in hand outrank both error and loading, the same precedence `mediaState` gives a
 *    cached URL: a background refetch that loses the network must not blank a list the member
 *    is reading.
 *
 * `isEmpty` is the caller's, not ours, because the shape differs per screen — `rows.length ===
 * 0` on a flat query, `data?.pages.flatMap(...)` on an infinite one, `card == null` on a
 * detail screen. What must NOT differ is what that emptiness is allowed to mean.
 */
export type ListState = 'idle' | 'loading' | 'error' | 'empty' | 'ready';

export function listState({
  status,
  fetchStatus,
  isEmpty,
}: {
  /** `query.status` — pending until the first settle, then error or success. */
  status: 'pending' | 'error' | 'success';
  /** `query.fetchStatus` — `idle` on a disabled query, `paused` when offline. */
  fetchStatus: 'fetching' | 'paused' | 'idle';
  /** Caller-derived: does the query's data amount to nothing to render? */
  isEmpty: boolean;
}): ListState {
  // Content outranks everything. A stale list beats an error screen, and beats a spinner.
  if (!isEmpty) return 'ready';
  if (status === 'error') return 'error';
  // `paused` is offline-with-intent: the read has neither failed nor returned nothing, so it
  // is still loading. Saying either of the other two here would be a false claim.
  if (status === 'pending') return fetchStatus === 'idle' ? 'idle' : 'loading';
  return 'empty';
}
