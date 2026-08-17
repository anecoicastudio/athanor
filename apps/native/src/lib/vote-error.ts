import type { MessageKey } from '@athanor/i18n';

/**
 * What a refused vote says to the member (#382).
 *
 * `cast_vote`'s `raise exception` strings are the stable contract — the same #103 idiom
 * `CONTRIB_ERROR_COPY` uses for `create-contribution-session`'s `{error}` strings. This map is
 * the client half; `20260815090015_cast_vote_window.sql` is the other, and pgTAP 0103 pins it.
 *
 * It exists because the vote path had NO copy at all. `annual.tsx`'s `onError` only rolled the
 * optimistic cache back and the detail screen had no `onError` whatsoever, so a refusal was
 * indistinguishable from a tap that never registered: the card stayed «Vota», the spinner
 * stopped, silence. That is the #111 failure shape — a screen asserting nothing while something
 * definite happened.
 *
 * Lives in `src/lib` rather than beside `CONTRIB_ERROR_COPY` in its screen for two reasons: two
 * screens cast votes, and this harness (`environment: 'node'`, `src/**\/*.test.ts`) cannot reach
 * a rule left inside a `.tsx` — the #413 idiom.
 */
export const CAST_VOTE_ERROR_COPY: Record<string, MessageKey> = {
  'voting closed': 'fund.vote.error.closed',
  'candidacy not votable': 'fund.vote.error.notVotable',
  'auth required': 'fund.vote.error.auth',
};

export type CastVoteError = {
  /** What to show the member. Never absent — an unknown refusal still says something. */
  key: MessageKey;
  /**
   * Whether the cached edition is now known to be wrong. True only for the window refusal:
   * the client believed the ballot was open and the server disagreed, so `fundKeys.activeEdition()`
   * is stale and re-reading it flips the surface to its real state instead of arguing (the #222
   * reasoning, applied to the vote path). A candidacy leaving the ballot or a dead session says
   * nothing about the edition.
   */
  editionStale: boolean;
};

/**
 * Read a refused `castVote` into copy. Total over `unknown`: the value arrives from a mutation's
 * `onError`, so it may be a `PostgrestError`, a transport `Error`, or something that is not an
 * error at all, and every one of those must still produce a sentence.
 */
export function castVoteError(err: unknown): CastVoteError {
  const message =
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
      ? (err as { message: string }).message
      : null;
  const key = message === null ? undefined : CAST_VOTE_ERROR_COPY[message];
  return {
    key: key ?? 'fund.vote.error',
    editionStale: message === 'voting closed',
  };
}
