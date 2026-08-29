/**
 * What the Momenti tab's deck is showing, derived once (issue #594).
 *
 * «Hai un Momento» used to render above all four arms of the tab's state branch, so the loading
 * skeleton, the failed read and the empty deck each told the member that a Momento was waiting —
 * in the cyan rule #4 spends on meaning. Same class as the string defect #111 fixed one layer
 * down, and the same remedy: a claim about the data may only be made once a read has settled
 * into that claim.
 *
 * Extracted from the .tsx for the reason `momenti-home.ts:23-25` gives — this app's vitest
 * harness is `environment: 'node'` with an `src/**\/*.test.ts` glob, so a rule left inside a
 * component is structurally unassertable, and this is precisely the rule that broke.
 *
 * Two claims, deliberately kept apart:
 *
 * 1. `hasMomento` — a card is actually on the stack. The eyebrow and the Pass/Connect buttons
 *    read the same field, so the claim and the controls that act on it cannot drift apart
 *    again. Home gates the identical string the same way: `MomentiCard` collapses its block
 *    when there is no top card.
 * 2. `neverHadOne` — nobody has been proposed yet, as opposed to «you have seen them all».
 *    An empty read alone cannot tell those apart: both mutations invalidate the deck, so
 *    swiping through makes the refetch return `[]` and «Quando troviamo la persona giusta»
 *    would land on a member who had just answered every card. `sweptThrough` is the only
 *    signal that separates them, and only WITHIN a session — it is the tab's latched
 *    `SwipeDeck.onEmpty`, so a member who swipes through, leaves and returns to an empty deck
 *    reads the never-had-one copy again. Closing that last gap needs a server-side «was ever
 *    proposed» fact, not a longer-lived client latch.
 */
export type MomentiDeckView = {
  /** A card is on the stack: the eyebrow may claim it and the swipe buttons may act on it. */
  hasMomento: boolean;
  /** Nothing left to deal — either the deck arrived empty or the member swiped through it. */
  exhausted: boolean;
  /** Of the two exhausted cases, the one where no Momento has ever been offered. */
  neverHadOne: boolean;
};

export function momentiDeckView({
  isLoading,
  isError,
  isSuccess,
  cardCount,
  sweptThrough,
}: {
  /** `query.isLoading` — pending AND fetching, i.e. a first read with nothing in hand. */
  isLoading: boolean;
  /** `query.isError`. An error outranks cards in hand here: re-reading costs one tap. */
  isError: boolean;
  /** `query.isSuccess`. Emptiness only counts as an answer once a read has succeeded. */
  isSuccess: boolean;
  /** How many cards the current read left on the stack. Never rendered — rule #3. */
  cardCount: number;
  /** The latched in-session swipe-through (`SwipeDeck.onEmpty`), cleared when cards return. */
  sweptThrough: boolean;
}): MomentiDeckView {
  const deckIsEmpty = isSuccess && cardCount === 0;
  const exhausted = deckIsEmpty || sweptThrough;

  return {
    hasMomento: !exhausted && !isLoading && !isError && cardCount > 0,
    exhausted,
    neverHadOne: deckIsEmpty && !sweptThrough,
  };
}
