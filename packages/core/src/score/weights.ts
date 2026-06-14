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
  /** Joining the Athanor Circle is never scored (rule #1). */
  CIRCLE_JOIN: 0,
  /** Contributing to Il Cuore (the fund) is never scored (rule #1). */
  FUND_CONTRIBUTION: 0,
} as const;

export type AuraWeightKey = keyof typeof AURA_WEIGHTS;
