import { describe, expect, it } from 'vitest';
import { consensusForCandidacy, consensusPercent } from './consensus';

describe('consensusPercent', () => {
  it('uses the Aura-weighted share when weights exist', () => {
    expect(consensusPercent({ weightedTotal: 6, sumWeighted: 10, voteCount: 1, sumVotes: 5 })).toBe(
      60,
    );
  });
  it('falls back to the vote-count share when all weights are 0 (engine dormant)', () => {
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
  it('uses Aura-weighted share (not vote-count share) when weighted_total is non-zero', () => {
    // 'a' has 1 vote out of 5 (20% by count) but 6 weighted out of 10 (60% by weight)
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
