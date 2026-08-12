import type { WeekRecap } from '@athanor/core';

/**
 * Which of FOUR things the Home week slot is looking at (issue #100).
 *
 * It used to be two — `data != null && !empty` or «Presto qui» — so a failed read, a read still
 * in flight, a read that never started, and a genuinely quiet week were one pixel-identical card
 * claiming the feature had not shipped. It shipped in M6; `(modal)/recap.tsx` renders it in full.
 *
 * Extracted from the .tsx for the same reason as `momenti-home.ts` and `aura-display.ts`: this
 * app's vitest harness is `environment: 'node'` with a `*.test.ts` glob, so a rule left inside a
 * component is structurally unassertable.
 */
export type WeekSlotState = 'pending' | 'error' | 'empty' | 'data';

/**
 * Did nothing happen this week?
 *
 * Three fields, not the type's five, and the two omissions are deliberate:
 *
 * - `streakDays` is IMPLIED by `auraWeek`. `packages/core/src/score/display.ts:90-95` walks back
 *   from TODAY and breaks at the first day with no positive event, so a non-zero streak requires
 *   a positive event today, which is inside the 7-day window, which makes `auraWeek` non-zero.
 *   #100 claims a member with a 7–8-day-old event "has a real streak and still gets the
 *   placeholder" — they do not; their streak is 0. Adding the term would be dead weight.
 * - `oreDonate` is hardcoded `0` in that same return (`display.ts:97`) and is never derived. That
 *   is #51. Testing it would assert the constant, not the week.
 *
 * `sogniAiutati` DOES earn its place, though narrowly: `display.ts:86` counts a `milestone_help`
 * without checking its sign, and `pointsFor` yields `40 × 1/(1+0.5(n−1))` (`score/award.ts:37-40`),
 * which needs a 160th reciprocal exchange to round to zero. The real path is `withinCap === false`
 * → 0 points, where the row counts a helped dream while contributing nothing to `auraWeek`. Rare,
 * but the whole point of this change is not swallowing a real event.
 */
export function weekRecapIsEmpty(recap: WeekRecap): boolean {
  return recap.auraWeek === 0 && recap.contributi === 0 && recap.sogniAiutati === 0;
}

/**
 * Collapse a TanStack query into the branch the slot should render.
 *
 * `isPending`, NOT `isLoading` — `aura-display.ts` documents the trap and this is the same one:
 * in TanStack v5 `isLoading` is `isPending && isFetching`, so a query held by `enabled: !!userId`
 * while the session hydrates reports `isLoading: false, isError: false, data: undefined` and falls
 * straight through every branch. `isPending` covers in-flight AND idle, which is #100's "the query
 * can be idle, not just pending" edge. The `data == null` guard behind it is belt-and-braces and
 * keeps the return type honest for the caller's non-null access.
 *
 * `isError` wins over cached data, deliberately. The query client persists to AsyncStorage with a
 * 24h `gcTime` and Aura decays, so a stale week presented as this week is the false-confidence
 * problem `aura-display.ts` refused for the score. Note `MomentiCard.tsx:41-44` decides the
 * OPPOSITE for the deck, and states the dividing line: a stale Aura number is a claim about a
 * person's worth, a stale proposal costs one wasted tap. This is the first kind.
 */
export function weekSlotState(query: {
  isPending: boolean;
  isError: boolean;
  data: WeekRecap | undefined;
}): WeekSlotState {
  if (query.isError) return 'error';
  if (query.isPending || query.data == null) return 'pending';
  return weekRecapIsEmpty(query.data) ? 'empty' : 'data';
}
