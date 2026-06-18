import type { CandidacyTallyRow } from '@athanor/schemas';

/**
 * Display-only consensus percentage for one candidacy (rule #1: never a score).
 * Prefers the server's Aura-weighted share; falls back to the raw vote-count share
 * when the weighted denominator is 0 — the Aura engine is dormant pre-deploy, so
 * every snapshot weight can be 0. Both empty → 0. The app NEVER computes weighting;
 * it only turns the server `candidacy_tally` aggregates into a 0–100 bar value.
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
