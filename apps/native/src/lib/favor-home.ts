import type { NeedsPage } from '@athanor/api';
import type { FavorNeed } from '@athanor/schemas';

/**
 * How many open needs Home previews. Two, not one: a single row reads as "this specific person
 * needs you", which is a claim the slot cannot make — `favor_needs` is ordered by recency, not by
 * fit. Two reads as "there is a queue", which is what it is. Not a count — rule #3 forbids
 * rendering the total, and this never does; it bounds a list.
 */
export const FAVOR_HOME_PREVIEW = 2;

/**
 * The first few open needs, for Home's nudge card (issue #99).
 *
 * `pages[0]` and only `pages[0]`: the sheet pages on scroll, Home shows the head of the same
 * cache entry. Reaching into later pages would make the card's contents depend on how far the
 * member had scrolled the *sheet* before backing out, which is not a property Home should have.
 *
 * `undefined` is the shape every non-answer shares — in flight, idle, and a cold error all arrive
 * as `query.data === undefined` — and they all collapse to `[]`, which the card renders as
 * nothing at all. That is deliberate and is NOT the #111 defect: `FavorNudgeCard` makes no claim
 * when it is silent, whereas the «Presto qui» it replaces asserted that a shipped feature did not
 * exist. `(modal)/favor.tsx:118-130` owns the error copy and the retry, for the member who went
 * looking.
 */
export function topOpenNeeds(
  pages: NeedsPage[] | undefined,
  limit = FAVOR_HOME_PREVIEW,
): FavorNeed[] {
  return pages?.[0]?.needs.slice(0, limit) ?? [];
}
