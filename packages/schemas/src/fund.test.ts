import { describe, expect, it } from 'vitest';
import {
  MIN_CONTRIBUTION_CENTS,
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
  carried_from_edition_id: null,
  winner_confirmed_at: null,
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
  // #216/#221 failure states — the enum mirrors fund_editions_closure_reason_check.
  it.each([
    'realized',
    'voided_underfunded',
    'voided_quorum',
    'voided_declined',
    'realization_failed',
  ])('accepts closure_reason %s', (closure_reason) => {
    expect(fundEditionSchema.safeParse({ ...validEdition, closure_reason }).success).toBe(true);
  });
  it.each(['voided', 'failed', ''])('rejects unknown closure_reason %s', (closure_reason) => {
    expect(fundEditionSchema.safeParse({ ...validEdition, closure_reason }).success).toBe(false);
  });
  // #221: rollover provenance — a required, nullable uuid key.
  it('requires carried_from_edition_id as a nullable uuid key (#221)', () => {
    const { carried_from_edition_id: _p, ...bare } = validEdition;
    expect(fundEditionSchema.safeParse(bare).success).toBe(false);
    expect(
      fundEditionSchema.safeParse({
        ...validEdition,
        carried_from_edition_id: '00000000-0000-0000-0000-0000000000b2',
      }).success,
    ).toBe(true);
    expect(
      fundEditionSchema.safeParse({ ...validEdition, carried_from_edition_id: 'pred-1' }).success,
    ).toBe(false);
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
  // #220: the confirmation stamp — present as a key, null until the winner confirms.
  it('requires winner_confirmed_at as a nullable timestamp key (#220)', () => {
    const { winner_confirmed_at: _w, ...bare } = validEdition;
    expect(fundEditionSchema.safeParse(bare).success).toBe(false);
    expect(
      fundEditionSchema.safeParse({
        ...validEdition,
        winner_confirmed_at: '2027-05-02T12:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      fundEditionSchema.safeParse({ ...validEdition, winner_confirmed_at: 1746187200 }).success,
    ).toBe(false);
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

// #387 — the €1 floor is ONE declaration. It lives here rather than in @athanor/core because
// packages/schemas is the leaf (core depends on schemas; the reverse would be a cycle), and
// because the floor is a validation bound before it is anything else. @athanor/core re-exports
// it, so every TS caller still reads one number. The literals below are deliberate: change the
// constant and these named tests fail, which is the whole point of consolidating it.
describe('MIN_CONTRIBUTION_CENTS', () => {
  it('is €1 (PRD §4.11) — the same floor the DB CHECK and the edge function carry', () => {
    expect(MIN_CONTRIBUTION_CENTS).toBe(100);
  });
});

describe('contributionSessionInputSchema', () => {
  // The schema derives its floor from the constant rather than restating it. Asserted at both
  // edges so the derivation cannot be silently loosened: one cent below is refused, the floor
  // itself is accepted.
  it('derives its floor from MIN_CONTRIBUTION_CENTS', () => {
    const at = contributionSessionInputSchema.safeParse({
      editionId: '00000000-0000-0000-0000-0000000000ed',
      amountCents: MIN_CONTRIBUTION_CENTS,
    });
    const below = contributionSessionInputSchema.safeParse({
      editionId: '00000000-0000-0000-0000-0000000000ed',
      amountCents: MIN_CONTRIBUTION_CENTS - 1,
    });
    expect(at.success).toBe(true);
    expect(below.success).toBe(false);
  });
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

  // #236 — the optional fee coverage. Absent is the default state and must stay valid: the
  // checkbox ships unticked (CRD 2011/83/EU Art. 22 excludes pre-ticked boxes), so the
  // commonest request carries no flag at all.
  it('accepts a request with no coverage choice at all', () => {
    const r = contributionSessionInputSchema.safeParse({
      editionId: '00000000-0000-0000-0000-0000000000ed',
      amountCents: 100,
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.coverFees).toBeUndefined();
  });
  it.each([true, false])('accepts coverFees %s', (coverFees) => {
    const r = contributionSessionInputSchema.safeParse({
      editionId: '00000000-0000-0000-0000-0000000000ed',
      amountCents: 100,
      coverFees,
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.coverFees).toBe(coverFees);
  });
  // The flag is a CHOICE, not a figure: a client that could name its own coverage could name
  // zero. The gross-up is the server's, so anything but a boolean is refused at the boundary.
  it.each([27, '27', 'true', null])('rejects a non-boolean coverFees %s', (coverFees) => {
    const r = contributionSessionInputSchema.safeParse({
      editionId: '00000000-0000-0000-0000-0000000000ed',
      amountCents: 100,
      coverFees,
    });
    expect(r.success).toBe(false);
  });
  // The floor is on the GIFT. €0,99 + coverage would clear €1 as a charge and must still fail.
  it('rejects a sub-€1 gift even when coverage is requested', () => {
    const r = contributionSessionInputSchema.safeParse({
      editionId: '00000000-0000-0000-0000-0000000000ed',
      amountCents: 99,
      coverFees: true,
    });
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
      coverage_cents: 0,
      charged_cents: 500,
      currency: 'eur',
      stripe_checkout_session_id: 'cs_1',
      stripe_payment_intent_id: 'pi_1',
      status: 'succeeded',
      created_at: '2026-06-18T00:00:00Z',
      updated_at: '2026-06-18T00:00:00Z',
    });
    expect(r.success).toBe(true);
  });

  // #236 — the split is part of the row, not an optional extra. A receipt screen that could
  // not tell the gift from the coverage would show a member «€1,27» for a €1,00 gift.
  it('parses a covered contribution, gift and coverage separable', () => {
    const r = fundContributionRow({ amount_cents: 100, coverage_cents: 27, charged_cents: 127 });
    expect(r.success).toBe(true);
    expect(r.success && r.data.amount_cents).toBe(100);
    expect(r.success && r.data.coverage_cents).toBe(27);
    expect(r.success && r.data.charged_cents).toBe(127);
  });
  // Both columns are NOT NULL in the DB (coverage defaults to 0; the charge is generated over
  // two NOT NULL parents). A row that lost either is a row whose receipt cannot be trusted.
  it.each(['coverage_cents', 'charged_cents'])('rejects a row missing %s', (col) => {
    expect(fundContributionRow({ [col]: undefined }).success).toBe(false);
  });
  it.each(['coverage_cents', 'charged_cents'])('rejects a null %s', (col) => {
    expect(fundContributionRow({ [col]: null }).success).toBe(false);
  });
  it('rejects a negative coverage — it could only mean skimming the gift', () => {
    expect(fundContributionRow({ coverage_cents: -27 }).success).toBe(false);
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
    coverage_cents: 0,
    charged_cents: 500,
    currency: 'eur',
    stripe_checkout_session_id: 'cs_1',
    stripe_payment_intent_id: 'pi_1',
    status: 'succeeded',
    created_at: '2026-06-18T00:00:00Z',
    updated_at: '2026-06-18T00:00:00Z',
    ...over,
  });
}
