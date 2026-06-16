/**
 * AURA_WEIGHTS — the single source of Aura point values (rule #10). The app
 * imports these for display-only hints (e.g. the `✦ +N Aura` compose hint);
 * the M6 `score-engine` edge function (service-role) is the only writer of the
 * actual award (rule #1). One edit here keeps the UI hint and the engine award
 * in lockstep. Circle membership and fund contributions are worth ZERO (rule #1).
 *
 * Backend ref: 07-score-engine.md §3.1. Extend (comment +2, project +4, …) at M6.
 */
export const AURA_WEIGHTS = {
  /** Sharing a Community post (M3 feed). Displayed as `✦ +6 Aura` in the composer. */
  POST_CREATE: 6,
  /** Posting a reply on a Community post (M3). Displayed as `✦ +2 Aura` in the reply input. */
  COMMENT_CREATE: 2,
  /** Celebrating someone's growth step (M3 story ✦). Displayed as `✦ +4 Aura`. */
  STORY_REACT: 4,
  /** Publishing a Costellazioni project (M3 board). Displayed as `✦ +4 Aura` in the composer. */
  PROJECT_CREATE: 4,
  /** Attending (checking in to) an Athanor Live event (M4/M6). Read-only «✦ +15 Aura» label on event detail. */
  EVENT_ATTEND: 15,
  /** Organizing an event whose attendees check in (M4/M6). Read-only label. */
  EVENT_ORGANIZE: 30,
  /**
   * A Momento conversation reaching ≥10 messages from BOTH sides (M5 records the
   * messages; the M6 engine awards +5 to each party — never client-written, rule #1).
   * Display-only constant; no `✦ +N` hint is shown in chat (the award is invisible in M5).
   */
  MOMENTO_CONV: 5,
  /** Joining the Athanor Circle is never scored (rule #1). */
  CIRCLE_JOIN: 0,
  /** Contributing to Il Cuore (the fund) is never scored (rule #1). */
  FUND_CONTRIBUTION: 0,
} as const;

export type AuraWeightKey = keyof typeof AURA_WEIGHTS;
