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

/**
 * The same decision one level up, for the surfaces that need the whole snapshot (score *and*
 * the six stars) rather than just the number.
 *
 * They all used to write `query.data ?? ZERO_AURA_SNAPSHOT`, which is worse than the score-only
 * bug it mirrors: it claims a score of zero AND six dark stars, so a network blip renders another
 * member as someone who has earned nothing at all. Returning `null` lets each surface say
 * «non lo so» instead — and makes the compiler find every place that has to.
 *
 * `ZERO_AURA_SNAPSHOT` itself stays correct where `@athanor/api` returns it: `getAuraScore`
 * hands it back only for a genuinely absent engine row, which really is a member at zero.
 * The bug was never the constant, it was coalescing a *failure* into it.
 */
export function auraSnapshotOrNull<T>(data: T | undefined, isError: boolean): T | null {
  if (isError || data == null) return null;
  return data;
}

/**
 * The same decision for the SIX STARS, which are a separate query from the score (issue #16).
 *
 * A named alias rather than a second implementation: the predicate is identical, and the
 * reason it needs its own name is that the star case is the one most likely to be "fixed" back.
 * `starsQuery.data ?? []` type-checks, reads as a harmless default, and is wrong — `[]` is the
 * shape of «this member has earned none of the six», so the fallback does not decline to answer,
 * it answers zero. On `ProfileView` the score and the stars are fully independent queries, so
 * the hero could show a real 320 while the grid below claimed six unearned stars; on
 * `user/[id].tsx` the claim is about ANOTHER member, made on the strength of the viewer's own
 * connection.
 *
 * Callers pass the result straight through to `starCellState` (`lib/star.ts`), which turns
 * `null` into the third render state. Widening the component props to `Star[] | null` is what
 * makes the compiler find every surface that has to decide.
 */
export function starsOrNull<T>(data: T | undefined, isError: boolean): T | null {
  return auraSnapshotOrNull(data, isError);
}
