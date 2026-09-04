import { describe, expect, it } from 'vitest';
import { candidacyTallyRowSchema, candidacyVoteSchema } from './vote.ts';

describe('candidacyVoteSchema', () => {
  it('parses an own-row vote (weight coerced from numeric string)', () => {
    const row = candidacyVoteSchema.parse({
      id: '11111111-1111-1111-1111-111111111111',
      edition_id: '22222222-2222-2222-2222-222222222222',
      candidacy_id: '33333333-3333-3333-3333-333333333333',
      voter_id: '44444444-4444-4444-4444-444444444444',
      weight: '0.700',
      created_at: '2026-06-18T00:00:00Z',
    });
    expect(row.weight).toBe(0.7);
  });
  it('rejects a non-uuid candidacy_id', () => {
    expect(() => candidacyVoteSchema.parse({ candidacy_id: 'nope' })).toThrow();
  });
});

describe('candidacyTallyRowSchema', () => {
  it('coerces bigint/numeric strings from the RPC', () => {
    const row = candidacyTallyRowSchema.parse({
      candidacy_id: '33333333-3333-3333-3333-333333333333',
      vote_count: '12',
      weighted_total: '8.4',
    });
    expect(row).toEqual({
      candidacy_id: '33333333-3333-3333-3333-333333333333',
      vote_count: 12,
      weighted_total: 8.4,
    });
  });
});
