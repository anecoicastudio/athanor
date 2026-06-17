import { describe, expect, it } from 'vitest';
import { fundEditionSchema, fundAggregateSchema } from './fund';

const validEdition = {
  id: '00000000-0000-0000-0000-0000000000a1',
  year: 2027,
  target_at: '2027-06-01T00:00:00.000Z',
  goal_cents: 5000000,
  phase: 'ethics',
  candidacy_window_open: false,
  contributions_enabled: false,
  winner_candidacy_id: null,
  created_at: '2026-06-17T00:00:00.000Z',
  updated_at: '2026-06-17T00:00:00.000Z',
};

describe('fundEditionSchema', () => {
  it('parses a valid edition row', () => {
    expect(fundEditionSchema.parse(validEdition).phase).toBe('ethics');
  });
  it('rejects an unknown phase', () => {
    expect(() => fundEditionSchema.parse({ ...validEdition, phase: 'launch' })).toThrow();
  });
});

describe('fundAggregateSchema', () => {
  it('parses a valid aggregate row', () => {
    const a = fundAggregateSchema.parse({
      edition_id: '00000000-0000-0000-0000-0000000000a1',
      raised_cents: 48328100,
      contributor_count: 13874,
      updated_at: '2026-06-17T00:00:00.000Z',
    });
    expect(a.contributor_count).toBe(13874);
  });
  it('rejects a negative raised total', () => {
    expect(() =>
      fundAggregateSchema.parse({
        edition_id: '00000000-0000-0000-0000-0000000000a1',
        raised_cents: -1,
        contributor_count: 0,
        updated_at: '2026-06-17T00:00:00.000Z',
      }),
    ).toThrow();
  });
});
