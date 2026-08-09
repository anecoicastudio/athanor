import { describe, expect, it } from 'vitest';
import type { SearchFilters } from '@athanor/schemas';
import {
  AURA_BUCKETS,
  STAR_VALUES,
  auraMinFromBucket,
  bucketFromAuraMin,
  parseFilters,
  parseStar,
  serializeFilters,
} from './search-filters';

describe('aura buckets', () => {
  it('«any» means no minimum', () => {
    expect(auraMinFromBucket('any')).toBeUndefined();
  });

  it('a numeric bucket becomes its number', () => {
    expect(auraMinFromBucket('500')).toBe(500);
    expect(auraMinFromBucket('700')).toBe(700);
    expect(auraMinFromBucket('850')).toBe(850);
  });

  it('bucketFromAuraMin inverts auraMinFromBucket for every offered bucket', () => {
    for (const bucket of AURA_BUCKETS) {
      const min = auraMinFromBucket(bucket);
      expect(bucketFromAuraMin(min === undefined ? undefined : String(min))).toBe(bucket);
    }
  });

  it('an absent or unrecognised minimum falls back to «any»', () => {
    expect(bucketFromAuraMin(undefined)).toBe('any');
    expect(bucketFromAuraMin('')).toBe('any');
    expect(bucketFromAuraMin('600')).toBe('any');
    expect(bucketFromAuraMin('not-a-number')).toBe('any');
  });
});

describe('parseStar', () => {
  it('accepts every value of the star enum', () => {
    for (const star of STAR_VALUES) expect(parseStar(star)).toBe(star);
  });

  it('carries all six stars — the sheet and the screen must agree on the set', () => {
    expect(STAR_VALUES).toHaveLength(6);
  });

  it('ignores anything outside the enum', () => {
    expect(parseStar('mentore')).toBeUndefined();
    expect(parseStar('VISIONARIO')).toBeUndefined();
    expect(parseStar('')).toBeUndefined();
    expect(parseStar(undefined)).toBeUndefined();
  });
});

describe('serializeFilters', () => {
  it('omits every absent value rather than writing empty params', () => {
    expect(serializeFilters({})).toEqual({});
  });

  it('stringifies auraMin', () => {
    expect(serializeFilters({ auraMin: 700 })).toEqual({ auraMin: '700' });
  });

  it('trims the city and drops it when only whitespace was typed', () => {
    expect(serializeFilters({ city: '  Milano  ' })).toEqual({ city: 'Milano' });
    expect(serializeFilters({ city: '   ' })).toEqual({});
    expect(serializeFilters({ city: '' })).toEqual({});
  });

  it('writes all three when all three are set', () => {
    expect(serializeFilters({ auraMin: 850, city: 'Roma', star: 'mentor' })).toEqual({
      auraMin: '850',
      city: 'Roma',
      star: 'mentor',
    });
  });
});

describe('parseFilters', () => {
  it('no params → undefined, i.e. unfiltered', () => {
    expect(parseFilters({})).toBeUndefined();
  });

  it('reads auraMin back as a number', () => {
    expect(parseFilters({ auraMin: '500' })?.auraMin).toBe(500);
  });

  it('drops a star outside the enum but keeps the rest of the filter', () => {
    expect(parseFilters({ city: 'Milano', star: 'wizard' })).toEqual({ city: 'Milano' });
  });

  it('an unparseable auraMin is dropped, not forwarded as NaN', () => {
    // A deep link carries whatever the URL says. `Number('abc')` is NaN, and NaN reaching
    // searchAll lands in the search_all RPC body, where searchFiltersSchema says auraMin is an
    // int 0..1000. Dropping it degrades to unfiltered, which is the safe direction.
    expect(parseFilters({ auraMin: 'abc' })).toBeUndefined();
  });

  it('an auraMin outside the schema range is dropped', () => {
    // searchFiltersSchema bounds it 0..1000 (packages/schemas/src/search.ts) — the bound is not
    // restated here, so widening the schema cannot leave this screen behind.
    expect(parseFilters({ auraMin: '1001' })).toBeUndefined();
    expect(parseFilters({ auraMin: '-1' })).toBeUndefined();
  });

  it('a non-integer auraMin is dropped', () => {
    expect(parseFilters({ auraMin: '500.5' })).toBeUndefined();
  });

  it("'1e3' is read as 1000, not coerced past the bound", () => {
    // Exponent notation is a valid Number() input; it must still clear the schema to survive.
    expect(parseFilters({ auraMin: '1e3' })?.auraMin).toBe(1000);
  });

  it('an empty city param still counts as "filtered"', () => {
    // Current behaviour, pinned: `params.city ?? undefined` keeps '' as '', so
    // `?city=` produces a filters object and lights the "filters applied" dot.
    expect(parseFilters({ city: '' })).toEqual({ city: '' });
  });
});

describe('round-trip: parse(serialize(f)) === f', () => {
  const cases: SearchFilters[] = [
    { auraMin: 500 },
    { auraMin: 700 },
    { auraMin: 850 },
    { city: 'Milano' },
    { star: 'creatore' },
    { auraMin: 500, city: 'Milano' },
    { auraMin: 850, star: 'ambasciatore' },
    { city: 'Bologna', star: 'innovatore' },
    { auraMin: 700, city: 'Torino', star: 'visionario' },
  ];

  for (const filters of cases) {
    it(`survives ${JSON.stringify(filters)}`, () => {
      expect(parseFilters(serializeFilters(filters))).toEqual(filters);
    });
  }

  it('every star survives a round trip', () => {
    for (const star of STAR_VALUES) {
      expect(parseFilters(serializeFilters({ star }))).toEqual({ star });
    }
  });

  it('every aura bucket survives sheet → params → screen → sheet', () => {
    for (const bucket of AURA_BUCKETS) {
      const params = serializeFilters({ auraMin: auraMinFromBucket(bucket) });
      const filters = parseFilters(params);
      const back = filters?.auraMin === undefined ? undefined : String(filters.auraMin);
      expect(bucketFromAuraMin(back)).toBe(bucket);
    }
  });

  it('the empty filter round-trips to "unfiltered", not to an empty object', () => {
    expect(parseFilters(serializeFilters({}))).toBeUndefined();
  });

  it('a whitespace-only city round-trips to unfiltered', () => {
    expect(parseFilters(serializeFilters({ city: '  ' }))).toBeUndefined();
  });

  it('the city is normalized by the trip, then stable across a second one', () => {
    const once = parseFilters(serializeFilters({ city: '  Milano ' }));
    expect(once).toEqual({ city: 'Milano' });
    expect(parseFilters(serializeFilters(once!))).toEqual(once);
  });
});
