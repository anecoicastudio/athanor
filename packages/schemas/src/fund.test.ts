import { describe, expect, it } from 'vitest';
import {
  fundEditionSchema,
  fundAggregateSchema,
  contributionSessionInputSchema,
  fundContributionSchema,
} from './fund';

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

describe('contributionSessionInputSchema', () => {
  it('accepts a valid €1 contribution', () => {
    const r = contributionSessionInputSchema.safeParse({
      editionId: '00000000-0000-0000-0000-0000000000ed',
      amountCents: 100,
    });
    expect(r.success).toBe(true);
  });
  it('rejects below €1', () => {
    const r = contributionSessionInputSchema.safeParse({
      editionId: '00000000-0000-0000-0000-0000000000ed',
      amountCents: 99,
    });
    expect(r.success).toBe(false);
  });
  it('rejects a non-uuid edition', () => {
    const r = contributionSessionInputSchema.safeParse({ editionId: 'nope', amountCents: 500 });
    expect(r.success).toBe(false);
  });
});

describe('fundContributionSchema', () => {
  it('parses a succeeded contribution row', () => {
    const r = fundContributionSchema.safeParse({
      id: '00000000-0000-0000-0000-0000000000c1',
      edition_id: '00000000-0000-0000-0000-0000000000ed',
      profile_id: '11111111-1111-1111-1111-111111111111',
      amount_cents: 500,
      currency: 'eur',
      stripe_checkout_session_id: 'cs_1',
      stripe_payment_intent_id: 'pi_1',
      status: 'succeeded',
      created_at: '2026-06-18T00:00:00Z',
      updated_at: '2026-06-18T00:00:00Z',
    });
    expect(r.success).toBe(true);
  });

  // Pins the enum to the DB CHECK (20260808093013 + supabase/tests/0078). 'failed' was the
  // terminal state for a delayed debit that never cleared; delayed settlement is gone, so
  // nothing can write it and a row carrying it must not parse — packages/api/src/fund.ts
  // parses every receipt row, so a silent widening here would surface as a blank screen.
  it.each(['pending', 'succeeded', 'refunded'])('accepts status %s', (status) => {
    expect(fundContributionRow({ status }).success).toBe(true);
  });

  it.each(['failed', 'processing', ''])('rejects status %s', (status) => {
    expect(fundContributionRow({ status }).success).toBe(false);
  });
});

/** A valid contribution row with `over` applied — keeps the enum cases to one line each. */
function fundContributionRow(over: Record<string, unknown>) {
  return fundContributionSchema.safeParse({
    id: '00000000-0000-0000-0000-0000000000c1',
    edition_id: '00000000-0000-0000-0000-0000000000ed',
    profile_id: '11111111-1111-1111-1111-111111111111',
    amount_cents: 500,
    currency: 'eur',
    stripe_checkout_session_id: 'cs_1',
    stripe_payment_intent_id: 'pi_1',
    status: 'succeeded',
    created_at: '2026-06-18T00:00:00Z',
    updated_at: '2026-06-18T00:00:00Z',
    ...over,
  });
}
