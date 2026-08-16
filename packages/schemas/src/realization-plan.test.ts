import { describe, expect, it } from 'vitest';
import { realizationPlanPhaseSchema, realizationPlanSchema } from './realization-plan';

/** A published plan as #229 will have written it. */
const plan = {
  id: '00000000-0000-0000-0000-0000000000a1',
  edition_id: '00000000-0000-0000-0000-0000000000ed',
  candidacy_id: '00000000-0000-0000-0000-0000000000ca',
  objective: 'Aprire il laboratorio di ceramica nel quartiere.',
  expected_result: 'Trenta persone formate entro dodici mesi.',
  professionals: 'Un ceramista, un elettricista.',
  suppliers: '',
  published_at: '2026-08-16T09:00:00+00:00',
  created_at: '2026-08-16T08:00:00+00:00',
  updated_at: '2026-08-16T09:00:00+00:00',
};

/** One phase of that plan: the three facts a tranche release reads. */
const phase = {
  id: '00000000-0000-0000-0000-0000000000f1',
  plan_id: plan.id,
  sort: 1,
  title: 'Allestimento dello spazio',
  scheduled_for: '2026-10-01',
  amount_cents: 250000,
  verification_criteria: 'Contratto di locazione firmato e foto dello spazio allestito.',
  verified_at: null,
  created_at: '2026-08-16T08:00:00+00:00',
  updated_at: '2026-08-16T08:00:00+00:00',
};

describe('realizationPlanSchema', () => {
  it('parses a published plan unchanged', () => {
    expect(realizationPlanSchema.parse(plan)).toEqual(plan);
  });

  it('parses a draft — published_at null is the draft state, not a missing field', () => {
    const draft = { ...plan, published_at: null };
    expect(realizationPlanSchema.parse(draft)).toEqual(draft);
    expect(() => realizationPlanSchema.parse({ ...plan, published_at: undefined })).toThrow();
  });

  it('requires objective and expected result — blank is not recorded', () => {
    for (const blank of ['', '   ', '\n']) {
      expect(() => realizationPlanSchema.parse({ ...plan, objective: blank })).toThrow();
      expect(() => realizationPlanSchema.parse({ ...plan, expected_result: blank })).toThrow();
    }
  });

  it('allows empty professionals and suppliers — recorded as none is a real answer', () => {
    const none = { ...plan, professionals: '', suppliers: '' };
    expect(realizationPlanSchema.parse(none)).toEqual(none);
  });

  it('mirrors the table CHECK bounds exactly, so no stored row fails its own schema', () => {
    // 4000 is the char_length ceiling on all four prose columns.
    const at = 'x'.repeat(4000);
    const past = 'x'.repeat(4001);
    for (const key of ['objective', 'expected_result', 'professionals', 'suppliers'] as const) {
      expect(realizationPlanSchema.parse({ ...plan, [key]: at })[key]).toHaveLength(4000);
      expect(() => realizationPlanSchema.parse({ ...plan, [key]: past })).toThrow();
    }
  });

  it('does not carry a budget column — «budget disponibile» is the cycle snapshot', () => {
    // FUND-25's «budget disponibile» is fund_editions.confirmed_pool_cents, read live.
    // A second copy here is how two numbers about one population start (D-8/D-19), so the
    // absence is asserted rather than assumed.
    expect(Object.keys(realizationPlanSchema.shape)).not.toContain('budget_cents');
    expect(Object.keys(realizationPlanSchema.shape)).not.toContain('pool_cents');
  });

  it('rejects non-uuid identifiers', () => {
    expect(() => realizationPlanSchema.parse({ ...plan, edition_id: 'cycle-1' })).toThrow();
    expect(() => realizationPlanSchema.parse({ ...plan, candidacy_id: 'cand-1' })).toThrow();
  });
});

describe('realizationPlanPhaseSchema', () => {
  it('parses a phase unchanged', () => {
    expect(realizationPlanPhaseSchema.parse(phase)).toEqual(phase);
  });

  it('rejects a zero or negative amount — a phase IS a tranche', () => {
    for (const amount of [0, -1]) {
      expect(() => realizationPlanPhaseSchema.parse({ ...phase, amount_cents: amount })).toThrow();
    }
  });

  it('rejects a non-integer amount and a fractional sort', () => {
    expect(() => realizationPlanPhaseSchema.parse({ ...phase, amount_cents: 1.5 })).toThrow();
    expect(() => realizationPlanPhaseSchema.parse({ ...phase, sort: 1.5 })).toThrow();
    expect(() => realizationPlanPhaseSchema.parse({ ...phase, sort: 0 })).toThrow();
  });

  it('requires a title and verification criteria — the release reads them', () => {
    expect(() => realizationPlanPhaseSchema.parse({ ...phase, title: '  ' })).toThrow();
    expect(() =>
      realizationPlanPhaseSchema.parse({ ...phase, verification_criteria: '' }),
    ).toThrow();
  });

  it('mirrors the phase CHECK bounds (title 200, criteria 2000)', () => {
    expect(
      realizationPlanPhaseSchema.parse({ ...phase, title: 'x'.repeat(200) }).title,
    ).toHaveLength(200);
    expect(() => realizationPlanPhaseSchema.parse({ ...phase, title: 'x'.repeat(201) })).toThrow();
    const criteria = 'x'.repeat(2000);
    expect(
      realizationPlanPhaseSchema.parse({ ...phase, verification_criteria: criteria })
        .verification_criteria,
    ).toHaveLength(2000);
    expect(() =>
      realizationPlanPhaseSchema.parse({ ...phase, verification_criteria: 'x'.repeat(2001) }),
    ).toThrow();
  });

  it('keeps verified_at nullable — #231 owns the gate, nothing writes it yet', () => {
    expect(realizationPlanPhaseSchema.parse(phase).verified_at).toBeNull();
    const verified = { ...phase, verified_at: '2026-10-02T10:00:00+00:00' };
    expect(realizationPlanPhaseSchema.parse(verified)).toEqual(verified);
  });
});
