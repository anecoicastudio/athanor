import { describe, expect, it, test } from 'vitest';
import {
  auraSnapshotSchema,
  STAR_KEYS,
  ZERO_AURA_SNAPSHOT,
  auraScoreSchema,
  auraEventSchema,
  starSchema,
  auraCelebrationPayload,
  auraEventTypeSchema,
  breakdownSchema,
} from './aura';

describe('aura snapshot', () => {
  it('has the six canonical stars (PRD §4.10 order)', () => {
    expect(STAR_KEYS).toEqual([
      'visionario',
      'mentor',
      'collaboratore',
      'creatore',
      'innovatore',
      'ambasciatore',
    ]);
  });

  it('parses a well-formed snapshot', () => {
    const r = auraSnapshotSchema.safeParse(ZERO_AURA_SNAPSHOT);
    expect(r.success).toBe(true);
  });

  it('zero snapshot is score 0 with every star unlit', () => {
    expect(ZERO_AURA_SNAPSHOT.score).toBe(0);
    expect(Object.values(ZERO_AURA_SNAPSHOT.stars).every((v) => v === false)).toBe(true);
  });

  it('rejects a negative score', () => {
    expect(auraSnapshotSchema.safeParse({ ...ZERO_AURA_SNAPSHOT, score: -1 }).success).toBe(false);
  });

  it('rejects a snapshot missing a star key', () => {
    const partialStars = {
      visionario: false,
      mentor: false,
      collaboratore: false,
      creatore: false,
      innovatore: false,
    };
    expect(auraSnapshotSchema.safeParse({ score: 0, stars: partialStars }).success).toBe(false);
  });
});

describe('aura read schemas (M6)', () => {
  test('auraScoreSchema parses a full row', () => {
    const ok = auraScoreSchema.safeParse({
      profileId: '11111111-1111-1111-1111-111111111111',
      score: 412,
      breakdown: {
        contributi: 10,
        eventi: 30,
        collaborazioni: 40,
        valore: 0,
        recensioni: 0,
        affidabilita: 50,
      },
      peakScore: 412,
      lastQualifyingActionAt: '2026-06-17T00:00:00.000Z',
      computedAt: '2026-06-17T00:00:00.000Z',
    });
    expect(ok.success).toBe(true);
  });
  test('auraScoreSchema rejects score > 1000', () => {
    expect(auraScoreSchema.safeParse({ profileId: 'x', score: 1500 }).success).toBe(false);
  });
  test('auraEventSchema allows null refId/reason and the decay type', () => {
    const ok = auraEventSchema.safeParse({
      id: '22222222-2222-2222-2222-222222222222',
      profileId: '11111111-1111-1111-1111-111111111111',
      type: 'decay',
      points: -12,
      refId: null,
      counterpartyId: null,
      reason: { weeks: 3 },
      createdAt: '2026-06-17T00:00:00.000Z',
    });
    expect(ok.success).toBe(true);
  });

  // The dampening key (PRD §4.9). Nullable rather than optional: the column is on every row
  // since the migration, but is null for solo actions and for every row written before it.
  test('auraEventSchema carries the counterparty of a reciprocal exchange', () => {
    const row = {
      id: '22222222-2222-2222-2222-222222222222',
      profileId: '11111111-1111-1111-1111-111111111111',
      type: 'milestone_help' as const,
      points: 40,
      refId: '44444444-4444-4444-4444-444444444444',
      reason: {},
      createdAt: '2026-06-17T00:00:00.000Z',
    };
    expect(
      auraEventSchema.safeParse({
        ...row,
        counterpartyId: '55555555-5555-4555-8555-555555555555',
      }).success,
    ).toBe(true);
    // Absent is not the same as null — a row missing the column means the read is stale.
    expect(auraEventSchema.safeParse(row).success).toBe(false);
    expect(auraEventSchema.safeParse({ ...row, counterpartyId: 'not-a-uuid' }).success).toBe(false);
  });
  test('starSchema accepts a nullable grantedAt + progress', () => {
    const ok = starSchema.safeParse({
      id: '33333333-3333-3333-3333-333333333333',
      profileId: '11111111-1111-1111-1111-111111111111',
      starId: 'mentor',
      grantedAt: null,
      progress: { done: 1, total: 3, unit: 'aiuti' },
    });
    expect(ok.success).toBe(true);
  });

  // PostgREST serializes timestamptz with a numeric offset (`+00:00`), NOT a `Z` suffix.
  // Plain z.string().datetime() rejects offsets → every real DB row would fail to parse.
  // These guard the read schemas against that (regression: Aura ledger broke on real data).
  test('auraEventSchema accepts a PostgREST +00:00 createdAt', () => {
    const ok = auraEventSchema.safeParse({
      id: '22222222-2222-2222-2222-222222222222',
      profileId: '11111111-1111-1111-1111-111111111111',
      type: 'event_attended',
      points: 25,
      refId: null,
      counterpartyId: null,
      reason: { src: 'engine' },
      createdAt: '2026-06-20T14:35:30.72216+00:00',
    });
    expect(ok.success).toBe(true);
  });
  test('auraScoreSchema accepts PostgREST +00:00 timestamps', () => {
    const ok = auraScoreSchema.safeParse({
      profileId: '11111111-1111-1111-1111-111111111111',
      score: 320,
      breakdown: {
        contributi: 80,
        eventi: 60,
        collaborazioni: 70,
        valore: 50,
        recensioni: 30,
        affidabilita: 30,
      },
      peakScore: 360,
      lastQualifyingActionAt: '2026-06-20T14:35:30.72216+00:00',
      computedAt: '2026-06-21T09:00:00.123456+00:00',
    });
    expect(ok.success).toBe(true);
  });
  test('starSchema accepts a PostgREST +00:00 grantedAt', () => {
    const ok = starSchema.safeParse({
      id: '33333333-3333-3333-3333-333333333333',
      profileId: '11111111-1111-1111-1111-111111111111',
      starId: 'visionario',
      grantedAt: '2026-06-11T14:35:30.72216+00:00',
      progress: { done: 1, total: 1, unit: 'sogno' },
    });
    expect(ok.success).toBe(true);
  });
});

describe('auraCelebrationPayload', () => {
  it('parses a tier-up + new-stars payload', () => {
    const parsed = auraCelebrationPayload.parse({ tier_up: 'bagliore', new_stars: ['creatore'] });
    expect(parsed.tier_up).toBe('bagliore');
    expect(parsed.new_stars).toEqual(['creatore']);
  });

  it('parses an empty payload (all fields optional)', () => {
    expect(auraCelebrationPayload.parse({})).toEqual({});
  });

  it('rejects a non-string-array new_stars', () => {
    expect(() => auraCelebrationPayload.parse({ new_stars: [1, 2] })).toThrow();
  });

  it('parses the stars-only shape the engine emits (tier_up: null)', () => {
    const parsed = auraCelebrationPayload.parse({ tier_up: null, new_stars: ['creatore'] });
    expect(parsed.tier_up ?? undefined).toBeUndefined();
    expect(parsed.new_stars).toEqual(['creatore']);
  });
});

// Rule #1's surface: the ledger types the score-engine may write. The literal list, never a
// loop over the constant — a loop asserts only that the array equals itself, so a blanked
// member stays green. Circle membership and fund contributions are absent BY DESIGN: they are
// not ledger types at all, so no code path could ever price them.
describe('auraEventTypeSchema — the nine ledger types', () => {
  it('admits exactly the eight signed actions plus decay, in ledger order', () => {
    expect(auraEventTypeSchema.options).toEqual([
      'identity_verified',
      'event_attended',
      'event_organized',
      'momento_conversation',
      'milestone_help',
      'own_milestone',
      'post_starred',
      'report_upheld',
      'decay',
    ]);
  });

  it('has no type for Circle membership or a fund contribution — reputation is never bought', () => {
    for (const bought of [
      'circle_joined',
      'circle_renewed',
      'fund_contribution',
      'fund_contributed',
      '',
    ]) {
      expect(auraEventTypeSchema.safeParse(bought).success).toBe(false);
    }
  });
});

describe('breakdown and star shapes', () => {
  it('a breakdown has exactly the six display buckets (backend 07 §2.2)', () => {
    expect(Object.keys(breakdownSchema.shape)).toEqual([
      'contributi',
      'eventi',
      'collaborazioni',
      'valore',
      'recensioni',
      'affidabilita',
    ]);
  });

  it('rejects a breakdown missing a bucket — a score is never partially broken down', () => {
    const { affidabilita: _dropped, ...fiveBuckets } = {
      contributi: 10,
      eventi: 30,
      collaborazioni: 40,
      valore: 0,
      recensioni: 0,
      affidabilita: 50,
    };
    expect(breakdownSchema.safeParse(fiveBuckets).success).toBe(false);
  });

  it('a star row is id, owner, star, grant time and a three-part progress', () => {
    expect(Object.keys(starSchema.shape)).toEqual([
      'id',
      'profileId',
      'starId',
      'grantedAt',
      'progress',
    ]);
    expect(Object.keys(starSchema.shape.progress.shape)).toEqual(['done', 'total', 'unit']);
  });

  it('rejects a star whose progress has no total — a fraction with no denominator', () => {
    expect(
      starSchema.safeParse({
        id: '33333333-3333-3333-3333-333333333333',
        profileId: '11111111-1111-1111-1111-111111111111',
        starId: 'mentor',
        grantedAt: null,
        progress: { done: 1, unit: 'aiuti' },
      }).success,
    ).toBe(false);
  });
});
