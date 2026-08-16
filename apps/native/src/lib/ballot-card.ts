import type { CandidateCard } from '@athanor/api';
import type { ProjectCategory } from '@athanor/schemas';

/**
 * What the ballot card decides before it renders (#227, FUND-09/10/11/50).
 *
 * Extracted from the .tsx for the reason `lib/fund-cycle.ts` records: this app's vitest
 * harness is `environment: 'node'` with an `src/**\/*.test.ts` glob, so a rule left inside a
 * component is structurally unassertable. The components stay thin readers of these.
 */

/** The ballot's category filter — the `project_category` vocabulary plus «all». */
export type BallotFilter = ProjectCategory | 'all';

/**
 * Vocabulary order for the chip row. Fixed rather than alphabetical so the row does not
 * reshuffle between cycles; mirrors `ProjectFilterTabs`, which filters the same enum.
 */
const CATEGORY_ORDER: ProjectCategory[] = [
  'startup',
  'artistic',
  'business',
  'scientific',
  'volunteer',
];

/**
 * The chips the ballot should offer: «all» plus only the categories actually on this ballot.
 *
 * Two behaviours, both deliberate. A chip for a category no candidate carries is a control
 * whose only outcome is an empty ballot — the member taps it and the vote disappears. And a
 * row offering «all» beside a single category is chrome pretending to be a control, so it
 * returns `[]` and the caller renders nothing. Uncategorised candidacies (category null,
 * still a first-class state per #226) are always reachable through «all».
 */
export function ballotFilters(cards: readonly CandidateCard[]): BallotFilter[] {
  const present = new Set(
    cards.map((c) => c.category).filter((c): c is ProjectCategory => c !== null),
  );
  if (present.size < 2) return [];
  return ['all', ...CATEGORY_ORDER.filter((c) => present.has(c))];
}

/**
 * The filter actually in force: the member's choice when it is still offered, «all» otherwise.
 *
 * A refetched page can drop the last candidate of a category — the chip vanishes while the
 * state still names it, which would leave an empty ballot with no chip lit and no way back
 * except a chip the member never sees. Derived rather than an effect: a `setState` in an
 * effect would render the empty ballot for one frame first.
 */
export function resolveFilter(
  filters: readonly BallotFilter[],
  wanted: BallotFilter,
): BallotFilter {
  return filters.includes(wanted) ? wanted : 'all';
}

/** Apply the chip. «all» is every card, including the uncategorised ones. */
export function filterCandidates(
  cards: readonly CandidateCard[],
  filter: BallotFilter,
): CandidateCard[] {
  return filter === 'all' ? [...cards] : cards.filter((c) => c.category === filter);
}

/**
 * The linked dream's confirmed history, or `null` when there is nothing honest to show.
 *
 * `null` covers three cases the card must treat identically — no dream linked, the linked
 * dream soft-deleted (the view's aggregate returns null for both), and a live linked dream
 * with nothing confirmed yet. The first two are «nothing to say»; the third is a deliberate
 * COLLAPSE, per DESIGN §11 2026-08-12 rule (b): a landed block with no data renders nothing
 * unless silence would be a claim about the member — and here silence says nothing about the
 * VOTER. Rendering «Tappe completate · 0» would manufacture a negative signal about a
 * candidate out of a dream planted last week, which is the shape rule #3 exists to refuse.
 *
 * Only confirmed states reach this function: the view counts milestones at 'done' and helps
 * at 'completed'. An offered help is a promise, and a promise is a number enthusiasm can
 * inflate — the ballot carries evidence of completed action or it carries nothing.
 */
export type ConfirmedHistory = { milestones: number; helps: number };

export function confirmedHistory(card: CandidateCard): ConfirmedHistory | null {
  if (card.dream_id === null) return null;
  const milestones = card.dream_milestones_done ?? 0;
  const helps = card.dream_helps_confirmed ?? 0;
  if (milestones === 0 && helps === 0) return null;
  return { milestones, helps };
}

/**
 * The author line's parts, in order, with the absent ones dropped — «marta · Torino ·
 * Artistico», «marta · Torino», or «marta».
 *
 * Composed here rather than in a catalog template because the old `fund.vote.author`
 * («{name} · {city} · categoria {category}») had two defects a single template cannot fix:
 * it rendered a trailing «· categoria » for the uncategorised candidacies #226 made
 * first-class, and it interpolated the RAW enum, so an Italian voter read «categoria
 * artistic» beside a filter chip saying «Artistico». The category label now arrives already
 * localized (`costellazioni.filter.*`, the same keys the candidacy wizard uses) and the word
 * «categoria» goes away as redundant next to it. The separator is punctuation, not copy.
 */
export function authorParts(parts: {
  handle: string | null;
  city: string | null;
  categoryLabel: string | null;
}): string[] {
  return [parts.handle, parts.city, parts.categoryLabel].filter(
    (p): p is string => p !== null && p !== '',
  );
}
