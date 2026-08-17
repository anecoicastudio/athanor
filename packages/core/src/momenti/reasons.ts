import type { MomentoReasonKind } from '@athanor/schemas';

/**
 * The order Momenti reason lines are shown in, hardest-earned first (#384).
 *
 * There are seven possible terms and room for about three, so this list decides which
 * ones a member ever sees. Until #384 the policy was implicit twice — the order terms
 * were appended in `rowToDeckCard`, and a `.slice(0, 3)` in the swipe card — which meant
 * a term's visibility depended on when it was written. The two newest and most expensive
 * terms were appended last and were therefore structurally invisible behind three
 * identity labels.
 *
 * The ranking is by how much the term says about THEM, which is roughly how hard it is
 * to earn:
 *
 *   mutualActivity  you were both in the same room, and a scan proved it
 *   profession      your crafts complete each other, per a ruled sparse map (#361)
 *   seeking         they are what you said you were looking for (#273 A)
 *   offering        you are what they said they were looking for
 *   skills          a curated skill you both claim (#123)
 *   shared          an identity label you both claim — the commonest term there is
 *   city            the same ≈20 km cell: a fact about geography, not about them
 *   newDream        the dream-recency fallback, which never travels with another reason
 */
export const REASON_PRIORITY: readonly MomentoReasonKind[] = [
  'mutualActivity',
  'profession',
  'seeking',
  'offering',
  'skills',
  'shared',
  'city',
  'newDream',
];

/**
 * How many reason lines a Momento card has room for (frontend §9). Stated once, here,
 * rather than as a `.slice(0, 3)` at each surface that renders reasons — the swipe card
 * and the home widget were slicing independently, so the two could disagree about which
 * three a member sees. `rowToDeckCard` applies it, and both surfaces render what they
 * are handed.
 */
export const MOMENTO_DECK_REASON_LIMIT = 3;

/**
 * The reasons worth showing, best first, at most `limit` of them.
 *
 * Generic over the reason shape so this stays pure data ordering: it reads `kind` and
 * nothing else, and returns the very objects it was given. A kind outside
 * `REASON_PRIORITY` sorts last rather than being dropped — a term that vanishes without
 * a trace is the failure this module exists to remove. The sort is stable, so equal
 * kinds keep the order they arrived in.
 */
export function rankReasons<T extends { kind: MomentoReasonKind }>(
  reasons: readonly T[],
  limit: number,
): T[] {
  // `< 1` rather than `<= 0`: a negative limit reaching `slice` means `slice(0, -1)`,
  // which returns all-but-the-last instead of nothing.
  if (limit < 1) return [];
  const rank = (kind: MomentoReasonKind) => {
    const i = REASON_PRIORITY.indexOf(kind);
    return i === -1 ? REASON_PRIORITY.length : i;
  };
  return [...reasons].sort((a, b) => rank(a.kind) - rank(b.kind)).slice(0, limit);
}
