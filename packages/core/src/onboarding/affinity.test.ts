import { describe, expect, it } from 'vitest';
import {
  AFFINITY_WEIGHTS,
  CITY_GEOHASH_MATCH_PRECISION,
  MOMENTO_AFFINITY_THRESHOLD,
  MUTUAL_ACTIVITY_CAP,
  PROFESSION_COMPLEMENTS,
  SEEKING_TO_IDENTITY,
  cityNear,
  expandSeeking,
  momentoAffinity,
  momentoAffinityTerms,
  professionPair,
} from './affinity';
import { CITY_GEOHASH_PRECISION } from './geohash';
import { PROFESSIONS } from './professions';
import { IDENTITY_TAGS, SEEKING_TAGS } from './tags';

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
});

describe('expandSeeking', () => {
  it('expands a seeking tag to the identities that answer it', () => {
    expect(expandSeeking(['mentorship'])).toEqual(['coach', 'mentor']);
  });

  it('deduplicates identities two seeking tags share', () => {
    // crescita and mentorship both reach `coach` — the union, not a multiset.
    expect(expandSeeking(['mentorship', 'crescita'])).toEqual(['coach', 'mentor']);
  });

  it('sorts the union rather than returning it in encounter order', () => {
    // «mentorship» is read first, so insertion order is coach, mentor, imprenditore,
    // investitore. Sorted order interleaves them — the SQL side is `order by 1`, and a
    // deck that reordered its own reason lines between two reads would look unstable.
    expect(expandSeeking(['mentorship', 'business'])).toEqual([
      'coach',
      'imprenditore',
      'investitore',
      'mentor',
    ]);
  });

  it('ignores a tag outside the vocabulary', () => {
    expect(expandSeeking(['business', 'not-a-tag'])).toEqual(['imprenditore', 'investitore']);
  });

  it('returns nothing for a purely generic seeking list', () => {
    expect(expandSeeking(['connessioni', 'eventi'])).toEqual([]);
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

/** Full profile from the fields a test cares about — the other terms stay silent. */
const profile = (p: Partial<Parameters<typeof momentoAffinityTerms>[0]>) => ({
  identityTags: [],
  seeking: [],
  skills: [],
  cityGeohash: null,
  attendedEventIds: [],
  profession: null,
  ...p,
});

const NO_TERMS = {
  shared: [],
  seekHit: [],
  offerHit: [],
  skillsShared: [],
  cityNear: false,
  mutualActivity: [],
  professionPair: [],
};

describe('momentoAffinityTerms', () => {
  it('scores a shared identity label', () => {
    const terms = momentoAffinityTerms(
      profile({ identityTags: ['artista', 'creativo'] }),
      profile({ identityTags: ['creativo'] }),
    );
    expect(terms).toEqual({ ...NO_TERMS, shared: ['creativo'] });
  });

  it('scores complementarity: what I seek is what they are', () => {
    const terms = momentoAffinityTerms(
      profile({ identityTags: ['freelance'], seeking: ['mentorship'] }),
      profile({ identityTags: ['mentor'] }),
    );
    expect(terms.seekHit).toEqual(['mentor']);
    expect(terms.shared).toEqual([]);
  });

  it('scores the reverse: what I am is what they seek', () => {
    const terms = momentoAffinityTerms(
      profile({ identityTags: ['investitore'] }),
      profile({ identityTags: ['artista'], seeking: ['business'] }),
    );
    expect(terms.offerHit).toEqual(['investitore']);
  });

  it('does not count a seeking tag against the other side’s seeking', () => {
    // Two people who both want mentorship are not a match on that alone — the term
    // is seeking ↔ identity in both directions, never seeking ↔ seeking.
    const terms = momentoAffinityTerms(
      profile({ identityTags: ['artista'], seeking: ['mentorship'] }),
      profile({ identityTags: ['creativo'], seeking: ['mentorship'] }),
    );
    expect(terms).toEqual(NO_TERMS);
  });

  it('is deterministic: terms come back sorted', () => {
    const terms = momentoAffinityTerms(
      profile({ identityTags: ['mentor', 'artista', 'coach'] }),
      profile({ identityTags: ['coach', 'mentor', 'artista'] }),
    );
    expect(terms.shared).toEqual(['artista', 'coach', 'mentor']);
  });

  it('counts a shared tag from outside the vocabulary, exactly as the SQL does', () => {
    // athanor.tag_intersect() intersects the RAW arrays; it holds no vocabulary list. Rows
    // predating the curated tags carry keys like 'design' (supabase/seed.sql did until #273),
    // and `validate.ts` is what stops new ones — not this. A spec that quietly dropped them
    // would disagree with the engine it exists to describe, and the mirror test only compares
    // the seeking map, so nothing would catch it.
    const terms = momentoAffinityTerms(
      profile({ identityTags: ['design'] }),
      profile({ identityTags: ['design'] }),
    );
    expect(terms.shared).toEqual(['design']);
  });

  it('masks a hidden field by receiving it empty', () => {
    // Visibility masking happens at the caller (the matcher blanks a private array);
    // an empty array must simply score nothing rather than throw or match all.
    const terms = momentoAffinityTerms(
      profile({ identityTags: ['mentor'], seeking: ['business'], skills: ['seo'] }),
      profile({}),
    );
    expect(momentoAffinity(terms)).toBe(0);
  });

  it('scores the skills overlap like the tag terms: sorted, deduplicated (#123)', () => {
    const terms = momentoAffinityTerms(
      profile({ skills: ['sviluppo-web', 'branding', 'seo'] }),
      profile({ skills: ['branding', 'sviluppo-web', 'branding'] }),
    );
    expect(terms.skillsShared).toEqual(['branding', 'sviluppo-web']);
  });

  it('fires the city term when the two cells agree at the match precision (#123)', () => {
    // Stored at precision 5; compared at 4 — same ≈20 km cell, different ≈5 km cell.
    const terms = momentoAffinityTerms(
      profile({ cityGeohash: 'u0nd9' }),
      profile({ cityGeohash: 'u0ndb' }),
    );
    expect(terms.cityNear).toBe(true);
  });

  it('a member with no geohash contributes zero to the city term, gracefully', () => {
    // Free-text city stores NO geohash (#149) — the term skips them, both ways round.
    expect(momentoAffinityTerms(profile({}), profile({ cityGeohash: 'u0nd9' })).cityNear).toBe(
      false,
    );
    expect(momentoAffinityTerms(profile({ cityGeohash: 'u0nd9' }), profile({})).cityNear).toBe(
      false,
    );
  });

  it('scores mutual activity like the tag terms: sorted, deduplicated shared event ids (#361)', () => {
    const terms = momentoAffinityTerms(
      profile({ attendedEventIds: ['evt-c', 'evt-a', 'evt-b'] }),
      profile({ attendedEventIds: ['evt-b', 'evt-c', 'evt-b', 'evt-z'] }),
    );
    expect(terms.mutualActivity).toEqual(['evt-b', 'evt-c']);
  });

  it('strangers — no event in common — share no mutual activity', () => {
    const terms = momentoAffinityTerms(
      profile({ attendedEventIds: ['evt-a'] }),
      profile({ attendedEventIds: ['evt-b'] }),
    );
    expect(terms).toEqual(NO_TERMS);
    expect(momentoAffinity(terms)).toBe(0);
  });

  it('keeps the full intersection in the term — the cap is a scoring rule, not a truncation', () => {
    // The deck names every shared event; only the SCORE stops growing (#361).
    const five = ['e1', 'e2', 'e3', 'e4', 'e5'];
    const terms = momentoAffinityTerms(
      profile({ attendedEventIds: five }),
      profile({ attendedEventIds: five }),
    );
    expect(terms.mutualActivity).toEqual(five);
  });

  it('fires the profession term on a complementary pair, naming both crafts (#361)', () => {
    const terms = momentoAffinityTerms(
      profile({ profession: 'design' }),
      profile({ profession: 'sviluppo' }),
    );
    // [mine, theirs] — the reason line names the pairing from the reader's side.
    expect(terms).toEqual({ ...NO_TERMS, professionPair: ['design', 'sviluppo'] });
  });

  it('same craft is NOT complementarity — the shared-identity terms own that signal', () => {
    const terms = momentoAffinityTerms(
      profile({ profession: 'design' }),
      profile({ profession: 'design' }),
    );
    expect(terms).toEqual(NO_TERMS);
  });

  it('a non-complementary pair of real crafts stays silent', () => {
    const terms = momentoAffinityTerms(
      profile({ profession: 'legale' }),
      profile({ profession: 'arte' }),
    );
    expect(terms).toEqual(NO_TERMS);
  });

  it('a member with no profession contributes zero, gracefully, both ways round', () => {
    expect(
      momentoAffinityTerms(profile({}), profile({ profession: 'design' })).professionPair,
    ).toEqual([]);
    expect(
      momentoAffinityTerms(profile({ profession: 'design' }), profile({})).professionPair,
    ).toEqual([]);
  });

  it('a profession outside the vocabulary scores nothing rather than throwing', () => {
    // profiles.profession is app-validated, not CHECK-constrained — a legacy free-text
    // row must pass through the pure function silently, like unknown tags do.
    const terms = momentoAffinityTerms(
      profile({ profession: 'astronauta' }),
      profile({ profession: 'design' }),
    );
    expect(terms.professionPair).toEqual([]);
  });
});

describe('cityNear', () => {
  it('agrees at the match precision, not the storage precision', () => {
    expect(cityNear('u0nd9', 'u0ndb')).toBe(true); // differ only at char 5
    expect(cityNear('u0nd9', 'u0n5b')).toBe(false); // differ at char 4
  });

  it('never fires on a missing side', () => {
    expect(cityNear(null, 'u0nd9')).toBe(false);
    expect(cityNear('u0nd9', null)).toBe(false);
    expect(cityNear(null, null)).toBe(false);
  });

  it('never fires on a malformed, too-short hash', () => {
    // The DB CHECK pins exactly 5 chars; a shorter string can only reach the pure
    // function from a bug, and a 3-char prefix agreeing must not read as proximity.
    expect(cityNear('u0n', 'u0nd9')).toBe(false);
  });

  it('the match precision is coarser than the stored precision, so it stays tunable', () => {
    // #149 stored precision 5 exactly so the matcher could compare at fewer chars
    // WITHOUT a re-migration. Comparing at ≥ stored precision would break that.
    expect(CITY_GEOHASH_MATCH_PRECISION).toBeLessThan(CITY_GEOHASH_PRECISION);
    expect(CITY_GEOHASH_MATCH_PRECISION).toBe(4);
  });
});

describe('professionPair', () => {
  it('names the pair, reader first, when the map holds it', () => {
    expect(professionPair('musica', 'foto-video')).toEqual(['musica', 'foto-video']);
    expect(professionPair('foto-video', 'musica')).toEqual(['foto-video', 'musica']);
  });

  it('never fires on a missing side', () => {
    expect(professionPair(null, 'design')).toEqual([]);
    expect(professionPair('design', null)).toEqual([]);
    expect(professionPair(null, null)).toEqual([]);
  });

  it('never fires outside the vocabulary, on either side', () => {
    expect(professionPair('astronauta', 'design')).toEqual([]);
    expect(professionPair('design', 'astronauta')).toEqual([]);
  });
});

describe('momentoAffinity', () => {
  it('is the total number of terms that fired', () => {
    const terms = momentoAffinityTerms(
      profile({ identityTags: ['mentor'], seeking: ['business'] }),
      profile({ identityTags: ['mentor', 'imprenditore'], seeking: ['mentorship'] }),
    );
    // shared: mentor · seekHit: imprenditore · offerHit: mentor
    expect(terms).toEqual({
      ...NO_TERMS,
      shared: ['mentor'],
      seekHit: ['imprenditore'],
      offerHit: ['mentor'],
    });
    expect(momentoAffinity(terms)).toBe(3);
  });

  it('a single shared label falls under the proposal threshold', () => {
    // Issue #273 C: `affinity > 0` shipped a Momento on one tag out of seven.
    const terms = momentoAffinityTerms(
      profile({ identityTags: ['artista'], seeking: ['eventi'] }),
      profile({ identityTags: ['artista'], seeking: ['connessioni'] }),
    );
    expect(momentoAffinity(terms)).toBeLessThan(MOMENTO_AFFINITY_THRESHOLD);
  });

  it('complementarity alone can reach the threshold', () => {
    // mentor ↔ mentorship in both directions: the exact pairing the dead terms
    // existed for. Nothing shared, and still a real match.
    const terms = momentoAffinityTerms(
      profile({ identityTags: ['mentor'], seeking: ['business'] }),
      profile({ identityTags: ['imprenditore'], seeking: ['mentorship'] }),
    );
    expect(terms.shared).toEqual([]);
    expect(momentoAffinity(terms)).toBeGreaterThanOrEqual(MOMENTO_AFFINITY_THRESHOLD);
  });

  it('each shared skill weighs like a shared tag (#123 — parity, stated openly)', () => {
    const terms = momentoAffinityTerms(
      profile({ skills: ['sviluppo-web', 'branding'] }),
      profile({ skills: ['sviluppo-web', 'branding'] }),
    );
    expect(momentoAffinity(terms)).toBe(2 * AFFINITY_WEIGHTS.skill);
    expect(momentoAffinity(terms)).toBeGreaterThanOrEqual(MOMENTO_AFFINITY_THRESHOLD);
  });

  it('city proximity weighs once, at tag parity — it can complete a threshold, not meet it alone', () => {
    const near = momentoAffinityTerms(
      profile({ identityTags: ['artista'], cityGeohash: 'u0nd9' }),
      profile({ identityTags: ['artista'], cityGeohash: 'u0ndb' }),
    );
    expect(momentoAffinity(near)).toBe(AFFINITY_WEIGHTS.tag + AFFINITY_WEIGHTS.city);
    expect(momentoAffinity(near)).toBeGreaterThanOrEqual(MOMENTO_AFFINITY_THRESHOLD);

    const alone = momentoAffinityTerms(
      profile({ cityGeohash: 'u0nd9' }),
      profile({ cityGeohash: 'u0ndb' }),
    );
    expect(momentoAffinity(alone)).toBeLessThan(MOMENTO_AFFINITY_THRESHOLD);
  });

  it('every weight starts at parity — retuning is a one-line product decision, not a rewrite', () => {
    expect(AFFINITY_WEIGHTS).toEqual({ tag: 1, skill: 1, city: 1, activity: 1, profession: 1 });
  });

  it('a complementary craft weighs once, at parity — completes a threshold, never meets it alone (#361)', () => {
    const withTag = momentoAffinityTerms(
      profile({ identityTags: ['artista'], profession: 'arte' }),
      profile({ identityTags: ['artista'], profession: 'artigianato' }),
    );
    expect(momentoAffinity(withTag)).toBe(AFFINITY_WEIGHTS.tag + AFFINITY_WEIGHTS.profession);
    expect(momentoAffinity(withTag)).toBeGreaterThanOrEqual(MOMENTO_AFFINITY_THRESHOLD);

    const alone = momentoAffinityTerms(
      profile({ profession: 'arte' }),
      profile({ profession: 'artigianato' }),
    );
    expect(momentoAffinity(alone)).toBe(AFFINITY_WEIGHTS.profession);
    expect(momentoAffinity(alone)).toBeLessThan(MOMENTO_AFFINITY_THRESHOLD);
  });

  it('each shared event weighs like a shared tag, at parity (#361)', () => {
    const terms = momentoAffinityTerms(
      profile({ attendedEventIds: ['evt-a', 'evt-b'] }),
      profile({ attendedEventIds: ['evt-a', 'evt-b'] }),
    );
    expect(momentoAffinity(terms)).toBe(2 * AFFINITY_WEIGHTS.activity);
    expect(momentoAffinity(terms)).toBeGreaterThanOrEqual(MOMENTO_AFFINITY_THRESHOLD);
  });

  it('caps the contribution at MUTUAL_ACTIVITY_CAP — a serial event-goer cannot dominate', () => {
    const many = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'];
    const terms = momentoAffinityTerms(
      profile({ attendedEventIds: many }),
      profile({ attendedEventIds: many }),
    );
    expect(momentoAffinity(terms)).toBe(MUTUAL_ACTIVITY_CAP * AFFINITY_WEIGHTS.activity);
  });

  it('the cap clears the threshold — real shared history alone can ship a Momento', () => {
    expect(MUTUAL_ACTIVITY_CAP).toBe(3);
    expect(MUTUAL_ACTIVITY_CAP * AFFINITY_WEIGHTS.activity).toBeGreaterThanOrEqual(
      MOMENTO_AFFINITY_THRESHOLD,
    );
  });
});
