import { describe, expect, it } from 'vitest';
import {
  AFFINITY_WEIGHTS,
  CITY_GEOHASH_MATCH_PRECISION,
  MOMENTO_AFFINITY_THRESHOLD,
  MUTUAL_ACTIVITY_CAP,
  PROFESSION_COMPLEMENTS,
  SEEKING_TO_IDENTITY,
} from './affinity';
import { CITY_GEOHASH_PRECISION } from './geohash';
import { PROFESSIONS } from './professions';
import { IDENTITY_TAGS, SEEKING_TAGS } from './tags';

/**
 * These test the RULINGS — the maps and the tunables — not an engine. #384 deleted the
 * TypeScript affinity engine that used to live next to them; `athanor.momento_terms()`
 * is the only implementation now and `supabase/tests/0122_momento_terms_parity.test.sql`
 * asserts what it does. What is left here is data whose structure is a product decision,
 * so the assertions are about shape and value: symmetric, sparse, complete, at parity.
 * `affinity.mirror.test.ts` is the other half — it checks the SQL copies say the same.
 */

describe('SEEKING_TO_IDENTITY', () => {
  it('covers every seeking tag', () => {
    expect(Object.keys(SEEKING_TO_IDENTITY).sort()).toEqual([...SEEKING_TAGS].sort());
  });

  it('maps only to identity tags that exist', () => {
    const unknown = Object.values(SEEKING_TO_IDENTITY)
      .flat()
      .filter((tag) => !(IDENTITY_TAGS as readonly string[]).includes(tag));
    expect(unknown).toEqual([]);
  });

  it('leaves the two generic intents unmapped', () => {
    // «connessioni» and «eventi» name no profession, so no identity tag COMPLEMENTS
    // them. Mapping them to the whole vocabulary would make every pair score, which
    // is the same failure the intersect-only matcher already has.
    expect(SEEKING_TO_IDENTITY.connessioni).toEqual([]);
    expect(SEEKING_TO_IDENTITY.eventi).toEqual([]);
  });

  it('keeps each identity list sorted and deduplicated', () => {
    // `athanor.seeking_to_identity()` orders its output, and a deck whose reason lines
    // reordered between two reads would look unstable. Same contract, both languages.
    for (const [tag, identities] of Object.entries(SEEKING_TO_IDENTITY)) {
      expect(identities, `${tag} list is unsorted or carries a duplicate`).toEqual(
        [...new Set(identities)].sort(),
      );
    }
  });
});

describe('PROFESSION_COMPLEMENTS (#361)', () => {
  it('covers every profession key, and only profession keys', () => {
    expect(Object.keys(PROFESSION_COMPLEMENTS).sort()).toEqual([...PROFESSIONS].sort());
  });

  it('maps only to professions that exist', () => {
    const unknown = Object.values(PROFESSION_COMPLEMENTS)
      .flat()
      .filter((p) => !(PROFESSIONS as readonly string[]).includes(p));
    expect(unknown).toEqual([]);
  });

  it('is symmetric: a complements b exactly when b complements a', () => {
    for (const [a, complements] of Object.entries(PROFESSION_COMPLEMENTS)) {
      for (const b of complements) {
        expect(PROFESSION_COMPLEMENTS[b], `${a}↔${b} has no matching ${b}↔${a}`).toContain(a);
      }
    }
  });

  it('never pairs a profession with itself — same craft is not complementarity', () => {
    for (const [a, complements] of Object.entries(PROFESSION_COMPLEMENTS)) {
      expect(complements, `${a} pairs with itself`).not.toContain(a);
    }
  });

  it('stays sparse: each profession carries 2–4 complements, never the whole board', () => {
    // A map where everything complements everything scores every pair — the term
    // becomes noise, the #273 failure mode arrived at from a third direction.
    for (const [a, complements] of Object.entries(PROFESSION_COMPLEMENTS)) {
      expect(complements.length, `${a} has ${complements.length}`).toBeGreaterThanOrEqual(2);
      expect(complements.length, `${a} has ${complements.length}`).toBeLessThanOrEqual(4);
    }
  });

  it('encodes exactly the 23 ruled pairs — 46 directed entries', () => {
    // The ruling's map (issue #361, 2026-08-15) is data, not derivable — pin its SIZE
    // so a dropped or added pair fails even when symmetry and sparsity still hold.
    expect(Object.values(PROFESSION_COMPLEMENTS).flat()).toHaveLength(46);
  });

  it('keeps each complement list sorted and deduplicated', () => {
    for (const [a, complements] of Object.entries(PROFESSION_COMPLEMENTS)) {
      expect(complements, `${a} list is unsorted or carries a duplicate`).toEqual(
        [...new Set(complements)].sort(),
      );
    }
  });

  it('spot-checks the pairs-that-ship-together logic', () => {
    expect(PROFESSION_COMPLEMENTS.design).toContain('sviluppo');
    expect(PROFESSION_COMPLEMENTS.business).toContain('legale');
    expect(PROFESSION_COMPLEMENTS.musica).toContain('foto-video');
    // …and what the ruling deliberately left OUT stays out.
    expect(PROFESSION_COMPLEMENTS.design).not.toContain('food');
    expect(PROFESSION_COMPLEMENTS.legale).not.toContain('arte');
  });
});

describe('the tunables (rule 10)', () => {
  it('every weight starts at parity — retuning is a one-line product decision, not a rewrite', () => {
    expect(AFFINITY_WEIGHTS).toEqual({ tag: 1, skill: 1, city: 1, activity: 1, profession: 1 });
  });

  it('no weight is zero or negative — a term that cannot raise affinity is a dead term', () => {
    for (const [term, weight] of Object.entries(AFFINITY_WEIGHTS)) {
      expect(weight, `${term} weighs ${weight}`).toBeGreaterThan(0);
    }
  });

  it('one term alone never reaches the threshold — a Momento takes two signals (#273 C)', () => {
    // The whole point of the threshold: `affinity > 0` proposed on a single shared
    // label and the deck filled with noise. Every ONCE-per-pair term must therefore
    // stay strictly under it.
    expect(AFFINITY_WEIGHTS.tag).toBeLessThan(MOMENTO_AFFINITY_THRESHOLD);
    expect(AFFINITY_WEIGHTS.skill).toBeLessThan(MOMENTO_AFFINITY_THRESHOLD);
    expect(AFFINITY_WEIGHTS.city).toBeLessThan(MOMENTO_AFFINITY_THRESHOLD);
    expect(AFFINITY_WEIGHTS.profession).toBeLessThan(MOMENTO_AFFINITY_THRESHOLD);
  });

  it('the cap clears the threshold — real shared history alone can ship a Momento (#361)', () => {
    expect(MUTUAL_ACTIVITY_CAP).toBe(3);
    expect(MUTUAL_ACTIVITY_CAP * AFFINITY_WEIGHTS.activity).toBeGreaterThanOrEqual(
      MOMENTO_AFFINITY_THRESHOLD,
    );
  });

  it('the match precision is coarser than the stored precision, so it stays tunable (#123)', () => {
    // Storing at 5 and comparing at 4 is what lets the radius be retuned without a
    // re-migration of profiles.city_geohash.
    expect(CITY_GEOHASH_MATCH_PRECISION).toBeLessThan(CITY_GEOHASH_PRECISION);
    expect(CITY_GEOHASH_MATCH_PRECISION).toBeGreaterThan(0);
  });
});
