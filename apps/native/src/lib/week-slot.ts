import type { WeekRecap } from '@athanor/core';

/**
 * Domain emptiness for the Home week slot (issue #100).
 *
 * The QUERY-state half of this module — `weekSlotState`, which collapsed a TanStack query into
 * pending / error / empty / data — folded into `lib/list-state.ts` under #111, which is the
 * lift its own docblock asked for. What stays here is the part that was never about queries:
 * what counts as a quiet week. `listState` takes it as the `isEmpty` argument.
 *
 * Extracted from the .tsx for the same reason as `momenti-home.ts` and `aura-display.ts`: this
 * app's vitest harness is `environment: 'node'` with a `*.test.ts` glob, so a rule left inside a
 * component is structurally unassertable.
 */

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
