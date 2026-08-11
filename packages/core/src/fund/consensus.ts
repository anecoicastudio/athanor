import type { CandidacyTallyRow } from '@athanor/schemas';

/**
 * Display-only consensus percentage for one candidacy (rule #1: never a score).
 *
 * Every vote now weighs exactly 1.000 — equal vote, PRD §4.11 — so `weighted_total` and
 * `vote_count` carry the same information and the first branch is the one that fires.
 * The weighted arm and its zero-denominator fallback are kept because this is a pure
 * function over whatever the server's `candidacy_tally` returns: it must stay correct for
 * any weights, rather than assume an invariant enforced two layers away in SQL.
 *
 * Both empty → 0. The app NEVER computes weighting; it only turns the server aggregates
 * into a 0–100 bar value.
 */
export function consensusPercent(input: {
  weightedTotal: number;
  sumWeighted: number;
  voteCount: number;
  sumVotes: number;
}): number {
  const { weightedTotal, sumWeighted, voteCount, sumVotes } = input;
  if (sumWeighted > 0) return Math.round((100 * weightedTotal) / sumWeighted);
  if (sumVotes > 0) return Math.round((100 * voteCount) / sumVotes);
  return 0;
}

/** Sum an edition tally and read one candidacy's consensus % in a single call. */
export function consensusForCandidacy(tally: CandidacyTallyRow[], candidacyId: string): number {
  const sumWeighted = tally.reduce((acc, r) => acc + r.weighted_total, 0);
  const sumVotes = tally.reduce((acc, r) => acc + r.vote_count, 0);
  const row = tally.find((r) => r.candidacy_id === candidacyId);
  if (!row) return 0;
  return consensusPercent({
    weightedTotal: row.weighted_total,
    sumWeighted,
    voteCount: row.vote_count,
    sumVotes,
  });
}
