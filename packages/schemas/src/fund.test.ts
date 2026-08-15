import { describe, expect, it } from 'vitest';
import {
  fundEditionSchema,
  fundAggregateSchema,
  contributionSessionInputSchema,
  fundContributionSchema,
} from './fund';

const validEdition = {
  id: '00000000-0000-0000-0000-0000000000a1',
  target_at: '2027-06-01T00:00:00.000Z',
  goal_cents: 5000000,
  phase: 'voting',
  candidacy_window_open: false,
  contributions_enabled: false,
  winner_candidacy_id: null,
  voting_starts_at: '2027-04-01T00:00:00.000Z',
  voting_ends_at: '2027-05-01T00:00:00.000Z',
  min_funding_cents: 100000,
  min_voters: 5,
  min_candidacies: 3,
  split_pct: 10,
  cost_fee_statement:
    'Il 10% copre in parte costi e commissioni; la differenza è a carico di Athanor.',
  equity_declared: 'Nessuna partecipazione societaria nel progetto per questo ciclo.',
  closure_reason: null,
  confirmed_pool_cents: null,
  carried_in_cents: 0,
  created_at: '2026-06-17T00:00:00.000Z',
  updated_at: '2026-06-17T00:00:00.000Z',
};

describe('fundEditionSchema', () => {
  it('parses a valid cycle row', () => {
    expect(fundEditionSchema.parse(validEdition).phase).toBe('voting');
  });
  it.each(['candidacy', 'screening', 'voting', 'announcement', 'realization', 'closed'])(
    'accepts phase %s',
    (phase) => {
      expect(fundEditionSchema.safeParse({ ...validEdition, phase }).success).toBe(true);
    },
  );
  // The annual vocabulary is GONE (#215) — a row still carrying it must not parse.
  it.each(['community', 'reputation', 'ethics', 'event', 'launch'])(
    'rejects retired/unknown phase %s',
    (phase) => {
      expect(fundEditionSchema.safeParse({ ...validEdition, phase }).success).toBe(false);
    },
  );
  it('requires the three deferred minimums (FUND-SPEC §5)', () => {
    const { min_funding_cents: _f, min_voters: _v, min_candidacies: _c, ...bare } = validEdition;
    expect(fundEditionSchema.safeParse(bare).success).toBe(false);
  });
  it('rejects a non-positive quorum or candidacy minimum', () => {
    expect(fundEditionSchema.safeParse({ ...validEdition, min_voters: 0 }).success).toBe(false);
    expect(fundEditionSchema.safeParse({ ...validEdition, min_candidacies: 0 }).success).toBe(
      false,
    );
  });
  // #232: the declarations are mandatory at open — a null that parsed while they were
  // "nullable shape" (pre-20260815155811) must not parse anymore.
  it('bounds split_pct to 0–100 and refuses null (declared at open, #232)', () => {
    expect(fundEditionSchema.safeParse({ ...validEdition, split_pct: 101 }).success).toBe(false);
    expect(fundEditionSchema.safeParse({ ...validEdition, split_pct: null }).success).toBe(false);
  });
  it('refuses a null or empty declared statement (#232)', () => {
    expect(fundEditionSchema.safeParse({ ...validEdition, cost_fee_statement: null }).success).toBe(
      false,
    );
    expect(fundEditionSchema.safeParse({ ...validEdition, cost_fee_statement: '' }).success).toBe(
      false,
    );
    expect(fundEditionSchema.safeParse({ ...validEdition, equity_declared: null }).success).toBe(
      false,
    );
    expect(fundEditionSchema.safeParse({ ...validEdition, equity_declared: '' }).success).toBe(
      false,
    );
  });
  // #216 failure states — the enum mirrors fund_editions_closure_reason_check.
  it.each(['realized', 'voided_underfunded', 'voided_quorum', 'voided_declined'])(
    'accepts closure_reason %s',
    (closure_reason) => {
      expect(fundEditionSchema.safeParse({ ...validEdition, closure_reason }).success).toBe(true);
    },
  );
  it.each(['voided', 'failed', ''])('rejects unknown closure_reason %s', (closure_reason) => {
    expect(fundEditionSchema.safeParse({ ...validEdition, closure_reason }).success).toBe(false);
  });
  it('accepts a null or non-negative confirmed_pool_cents, rejects a negative one (#216)', () => {
    expect(
      fundEditionSchema.safeParse({ ...validEdition, confirmed_pool_cents: 4832810 }).success,
    ).toBe(true);
    expect(fundEditionSchema.safeParse({ ...validEdition, confirmed_pool_cents: -1 }).success).toBe(
      false,
    );
  });
  it('requires carried_in_cents and rejects a negative one (FUND-45 — always readable)', () => {
    const { carried_in_cents: _k, ...bare } = validEdition;
    expect(fundEditionSchema.safeParse(bare).success).toBe(false);
    expect(fundEditionSchema.safeParse({ ...validEdition, carried_in_cents: null }).success).toBe(
      false,
    );
    expect(fundEditionSchema.safeParse({ ...validEdition, carried_in_cents: -1 }).success).toBe(
      false,
    );
    expect(fundEditionSchema.safeParse({ ...validEdition, carried_in_cents: 250000 }).success).toBe(
      true,
    );
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

  // Mirrors the #239 migration: profile_id is NOT NULL, contributions are never anonymous (D24).
  it('rejects a null profile_id', () => {
    expect(fundContributionRow({ profile_id: null }).success).toBe(false);
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
