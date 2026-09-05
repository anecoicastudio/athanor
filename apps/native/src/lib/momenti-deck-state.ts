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
 *    would land on a member who had just answered every card. Two signals separate them, and
 *    it takes both (#600):
 *
 *    - `sweptThrough`, the tab's latched `SwipeDeck.onEmpty`, holds WITHIN a session. It fires
 *      the instant the deck runs out, before the mutation and the refetch have settled, which
 *      is why it cannot be dropped in favour of the server fact alone.
 *    - `everAnswered`, a persisted read of «has this member ever accepted or passed a Momento»
 *      (`hasAnsweredMomento`), holds ACROSS sessions. It exists because the latch is component
 *      state and dies on a REMOUNT — a cold start, a dev reload, a sign-out/sign-in. A tab
 *      switch is not one of those: expo-router's vendored bottom-tabs keeps a visited tab mounted
 *      (no `unmountOnBlur` in v7, and this app sets no `freezeOnBlur`/`detachInactiveScreens`),
 *      so the latch survives navigation. #600's original wording said otherwise and a QA walk
 *      following it would have found the screen correct. What the remount does is worse than a
 *      plain refetch: the persisted query cache rehydrates the empty deck as a settled success
 *      while `done` resets to false, so the very first frame after a restart offered the
 *      never-had-one promise to someone who swiped through yesterday.
 *
 *    `everAnswered` is `undefined` until its own read settles, and an unsettled fact may not be
 *    claimed on — the rule this whole module exists to enforce. So the promise is made only on
 *    a settled `false`; anything else falls back to «Torna più tardi», which is true either way.
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
  everAnswered,
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
  /**
   * Settled «this member has accepted or passed a Momento before», surviving a remount.
   * `undefined` while that read is in flight or after it failed — never a claim, so the
   * never-had-one promise is withheld rather than guessed.
   */
  everAnswered: boolean | undefined;
}): MomentiDeckView {
  const deckIsEmpty = isSuccess && cardCount === 0;
  const exhausted = deckIsEmpty || sweptThrough;

  return {
    hasMomento: !exhausted && !isLoading && !isError && cardCount > 0,
    exhausted,
    // `everAnswered === false` and not `!everAnswered`: `undefined` is an unsettled read,
    // and the two must not collapse into the same claim.
    neverHadOne: deckIsEmpty && !sweptThrough && everAnswered === false,
  };
}
