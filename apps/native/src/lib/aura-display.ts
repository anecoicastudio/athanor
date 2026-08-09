/**
 * How an Aura score reads when we could not fetch it.
 *
 * The three surfaces that show someone's Aura all used to coalesce a failed read to zero
 * (`data?.score ?? 0`). Zero is not "unknown" — it is a real, meaningful score that says this
 * person has earned nothing, which for a reputation the PRD describes as earned-only (§1.1) is
 * the most damaging thing a network error could claim. It is also indistinguishable from a
 * genuine new member, so nobody could tell the failure from the fact.
 *
 * The glyph is the em dash `—` the app already uses for every other unknown value (17 sites,
 * including the missing-handle fallbacks in the same two files this is wired into). It needs no
 * i18n key: rule #5 governs user-facing *words*, and this is punctuation that renders identically
 * in IT and EN. The spoken form does need a key — see `aura.unknown`, used as the
 * accessibilityLabel, because "em dash" is not something to read out.
 *
 * Extracted rather than inlined three times because `apps/native`'s vitest harness is
 * `environment: 'node'` with a `*.test.ts` glob — the 176 `.tsx` files are structurally
 * unreachable, so logic left in a screen cannot be tested at all. Same reason as the other
 * `src/lib` extractions.
 */
export const AURA_UNKNOWN = '—';

/**
 * Render an Aura score for display, or the unknown placeholder when we cannot vouch for it.
 *
 * `score == null` is the common path and the one that matters: `data?.score` is `undefined`
 * while a query is loading, while it is *disabled* (every screen here gates on `enabled: !!userId`
 * and the session hydrates async), and on a cold error. A hand-rolled `isLoading` check does NOT
 * cover the disabled case — in TanStack v5 `isLoading` is `isPending && isFetching`, so a disabled
 * query reports `isLoading: false, isError: false, data: undefined` and falls straight through to
 * rendering the coalesced zero. That is the original bug wearing a different hat.
 *
 * `isError` additionally wins over a *cached* score. That is a deliberate trade, not an oversight:
 * the query client persists to AsyncStorage with a 24h `gcTime`, and Aura decays, so a stale
 * persisted number presented as current is the same false-confidence problem in slower motion.
 * If a surface ever needs "keep the last good value while a background refetch retries", the
 * narrower predicate is TanStack's own `isLoadingError` (`isError && !hasData`) — pass that
 * instead of `isError` rather than widening this function.
 */
export function auraDisplayValue(score: number | null | undefined, isError: boolean): string {
  if (isError || score == null) return AURA_UNKNOWN;
  return String(score);
}
