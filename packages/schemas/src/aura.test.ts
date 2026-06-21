import { describe, expect, it, test } from 'vitest';
import {
  auraSnapshotSchema,
  STAR_KEYS,
  ZERO_AURA_SNAPSHOT,
  auraScoreSchema,
  auraEventSchema,
  starSchema,
  auraCelebrationPayload,
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
      reason: { weeks: 3 },
      createdAt: '2026-06-17T00:00:00.000Z',
    });
    expect(ok.success).toBe(true);
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
