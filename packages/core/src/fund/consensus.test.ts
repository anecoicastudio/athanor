import { describe, expect, it } from 'vitest';
import { consensusForCandidacy, consensusPercent } from './consensus';

describe('consensusPercent', () => {
  // What the server actually emits since equal vote (PRD §4.11): every weight is 1.000, so
  // weighted_total === vote_count on every row candidacy_tally returns. The weighted branch still
  // fires — it just agrees with the count share. This is the production path; the cases below it
  // cover shapes the function must survive but the database no longer produces.
  it('matches the vote-count share when every vote weighs the same (equal vote)', () => {
    expect(consensusPercent({ weightedTotal: 3, sumWeighted: 6, voteCount: 3, sumVotes: 6 })).toBe(
      50,
    );
  });
  it('prefers the weighted share when weights differ', () => {
    expect(consensusPercent({ weightedTotal: 6, sumWeighted: 10, voteCount: 1, sumVotes: 5 })).toBe(
      60,
    );
  });
  it('falls back to the vote-count share when the weighted denominator is 0', () => {
    expect(consensusPercent({ weightedTotal: 0, sumWeighted: 0, voteCount: 3, sumVotes: 4 })).toBe(
      75,
    );
  });
  it('rounds to the nearest integer', () => {
    expect(consensusPercent({ weightedTotal: 1, sumWeighted: 3, voteCount: 1, sumVotes: 3 })).toBe(
      33,
    );
  });
  it('is 0 when there are no votes at all', () => {
    expect(consensusPercent({ weightedTotal: 0, sumWeighted: 0, voteCount: 0, sumVotes: 0 })).toBe(
      0,
    );
  });
});

describe('consensusForCandidacy', () => {
  const tally = [
    { candidacy_id: 'a', vote_count: 3, weighted_total: 0 },
    { candidacy_id: 'b', vote_count: 1, weighted_total: 0 },
  ];
  it('sums the edition tally and returns one candidacy share (vote-count fallback)', () => {
    expect(consensusForCandidacy(tally, 'a')).toBe(75);
  });
  it('returns 0 for a candidacy absent from the tally', () => {
    expect(consensusForCandidacy(tally, 'z')).toBe(0);
  });
  it('reads an equal-weight tally — the only shape the server now returns', () => {
    // Every weight is 1.000, so weighted_total mirrors vote_count row for row: 3 of 4 = 75%,
    // reached through the weighted branch rather than the fallback.
    const equalTally = [
      { candidacy_id: 'a', vote_count: 3, weighted_total: 3 },
      { candidacy_id: 'b', vote_count: 1, weighted_total: 1 },
    ];
    expect(consensusForCandidacy(equalTally, 'a')).toBe(75);
  });
  it('prefers the weighted share over the count share when weights differ', () => {
    // 'a' has 1 vote out of 5 (20% by count) but 6 weighted out of 10 (60% by weight).
    // Unreachable from the current schema; kept because this is a pure function over whatever
    // candidacy_tally returns, not a mirror of an invariant enforced two layers away in SQL.
    const weightedTally = [
      { candidacy_id: 'a', vote_count: 1, weighted_total: 6 },
      { candidacy_id: 'b', vote_count: 4, weighted_total: 4 },
    ];
    expect(consensusForCandidacy(weightedTally, 'a')).toBe(60);
  });
  it('returns 100 for a single-candidate edition (vote-count fallback, no other candidates)', () => {
    // weighted_total is 0 so falls back to vote-count; only one row → 3/3 = 100%
    const soloTally = [{ candidacy_id: 'solo', vote_count: 3, weighted_total: 0 }];
    expect(consensusForCandidacy(soloTally, 'solo')).toBe(100);
  });
});
