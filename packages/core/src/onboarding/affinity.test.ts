import { describe, expect, it } from 'vitest';
import {
  MOMENTO_AFFINITY_THRESHOLD,
  SEEKING_TO_IDENTITY,
  expandSeeking,
  momentoAffinity,
  momentoAffinityTerms,
} from './affinity';
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

describe('momentoAffinityTerms', () => {
  it('scores a shared identity label', () => {
    const terms = momentoAffinityTerms(
      { identityTags: ['artista', 'creativo'], seeking: [] },
      { identityTags: ['creativo'], seeking: [] },
    );
    expect(terms).toEqual({ shared: ['creativo'], seekHit: [], offerHit: [] });
  });

  it('scores complementarity: what I seek is what they are', () => {
    const terms = momentoAffinityTerms(
      { identityTags: ['freelance'], seeking: ['mentorship'] },
      { identityTags: ['mentor'], seeking: [] },
    );
    expect(terms.seekHit).toEqual(['mentor']);
    expect(terms.shared).toEqual([]);
  });

  it('scores the reverse: what I am is what they seek', () => {
    const terms = momentoAffinityTerms(
      { identityTags: ['investitore'], seeking: [] },
      { identityTags: ['artista'], seeking: ['business'] },
    );
    expect(terms.offerHit).toEqual(['investitore']);
  });

  it('does not count a seeking tag against the other side’s seeking', () => {
    // Two people who both want mentorship are not a match on that alone — the term
    // is seeking ↔ identity in both directions, never seeking ↔ seeking.
    const terms = momentoAffinityTerms(
      { identityTags: ['artista'], seeking: ['mentorship'] },
      { identityTags: ['creativo'], seeking: ['mentorship'] },
    );
    expect(terms).toEqual({ shared: [], seekHit: [], offerHit: [] });
  });

  it('is deterministic: terms come back sorted', () => {
    const terms = momentoAffinityTerms(
      { identityTags: ['mentor', 'artista', 'coach'], seeking: [] },
      { identityTags: ['coach', 'mentor', 'artista'], seeking: [] },
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
      { identityTags: ['design'], seeking: [] },
      { identityTags: ['design'], seeking: [] },
    );
    expect(terms.shared).toEqual(['design']);
  });

  it('masks a hidden field by receiving it empty', () => {
    // Visibility masking happens at the caller (the matcher blanks a private array);
    // an empty array must simply score nothing rather than throw or match all.
    const terms = momentoAffinityTerms(
      { identityTags: ['mentor'], seeking: ['business'] },
      { identityTags: [], seeking: [] },
    );
    expect(momentoAffinity(terms)).toBe(0);
  });
});

describe('momentoAffinity', () => {
  it('is the total number of terms that fired', () => {
    const terms = momentoAffinityTerms(
      { identityTags: ['mentor'], seeking: ['business'] },
      { identityTags: ['mentor', 'imprenditore'], seeking: ['mentorship'] },
    );
    // shared: mentor · seekHit: imprenditore · offerHit: mentor
    expect(terms).toEqual({
      shared: ['mentor'],
      seekHit: ['imprenditore'],
      offerHit: ['mentor'],
    });
    expect(momentoAffinity(terms)).toBe(3);
  });

  it('a single shared label falls under the proposal threshold', () => {
    // Issue #273 C: `affinity > 0` shipped a Momento on one tag out of seven.
    const terms = momentoAffinityTerms(
      { identityTags: ['artista'], seeking: ['eventi'] },
      { identityTags: ['artista'], seeking: ['connessioni'] },
    );
    expect(momentoAffinity(terms)).toBeLessThan(MOMENTO_AFFINITY_THRESHOLD);
  });

  it('complementarity alone can reach the threshold', () => {
    // mentor ↔ mentorship in both directions: the exact pairing the dead terms
    // existed for. Nothing shared, and still a real match.
    const terms = momentoAffinityTerms(
      { identityTags: ['mentor'], seeking: ['business'] },
      { identityTags: ['imprenditore'], seeking: ['mentorship'] },
    );
    expect(terms.shared).toEqual([]);
    expect(momentoAffinity(terms)).toBeGreaterThanOrEqual(MOMENTO_AFFINITY_THRESHOLD);
  });
});
