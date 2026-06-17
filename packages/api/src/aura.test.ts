import { describe, expect, it, test } from 'vitest';
import { ZERO_AURA_SNAPSHOT } from '@athanor/schemas';
import { auraKeys, ledgerKeys, starKeys, getAuraScore } from './aura';

// ---------------------------------------------------------------------------
// Key factory shapes
// ---------------------------------------------------------------------------

describe('aura key factories', () => {
  test('shapes', () => {
    expect(auraKeys.score('p1')).toEqual(['aura', 'score', 'p1']);
    expect(ledgerKeys.list('p1', 'gained')).toEqual(['ledger', 'p1', { filter: 'gained' }]);
    expect(starKeys.list('p1')).toEqual(['stars', 'p1']);
  });

  it('existing key shapes still work', () => {
    expect(auraKeys.detail('abc')).toEqual(['aura', 'detail', 'abc']);
  });
});

// ---------------------------------------------------------------------------
// getAuraScore coalesce tests
// ---------------------------------------------------------------------------

describe('getAuraScore coalesce', () => {
  test('missing aura_scores row → zero snapshot (never null)', async () => {
    const client = makeClientReturning({ score: null, stars: [] });
    const snap = await getAuraScore(client as never, 'p1');
    expect(snap).toEqual(ZERO_AURA_SNAPSHOT);
  });

  test('real row + earned mentor star → snapshot reflects them', async () => {
    const client = makeClientReturning({
      score: { score: 412 },
      stars: [{ star_id: 'mentor', granted_at: '2026-06-17T00:00:00Z' }],
    });
    const snap = await getAuraScore(client as never, 'p1');
    expect(snap.score).toBe(412);
    expect(snap.stars.mentor).toBe(true);
    expect(snap.stars.creatore).toBe(false);
  });

  test('score row but no stars → score set, all stars false', async () => {
    const client = makeClientReturning({ score: { score: 99 }, stars: [] });
    const snap = await getAuraScore(client as never, 'p1');
    expect(snap.score).toBe(99);
    expect(Object.values(snap.stars).every((v) => v === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Minimal chainable stub — matches the repo's api test helper style (moments.test.ts)
// ---------------------------------------------------------------------------

function makeClientReturning(fixtures: { score: unknown; stars: unknown[] }) {
  const score = fixtures.score as { score: number } | null;
  return {
    from(table: string) {
      if (table === 'aura_scores') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: score, error: null }) }),
          }),
        };
      }
      // stars table
      return { select: () => ({ eq: () => ({ data: fixtures.stars, error: null }) }) };
    },
  };
}
