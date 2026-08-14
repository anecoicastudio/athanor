import { describe, expect, it } from 'vitest';
import { CITY_GEOHASH_PRECISION, encodeGeohash } from './geohash';

/**
 * Geohash encoder for the approximate profile city (#149, PRD §4.2 «city
 * (approximate)»). The city picker resolves a selected suggestion's
 * coordinates to a precision-5 geohash (≈ 4.9 × 4.9 km cell) — deliberately
 * coarse, never device geolocation. Free-text city stores no geohash at all.
 */
describe('encodeGeohash', () => {
  it('encodes the anchor cities at precision 5', () => {
    // Independently verified cells (geohash.org): Roma centro, Milano centro.
    expect(encodeGeohash(41.8933, 12.4829, 5)).toBe('sr2yk');
    expect(encodeGeohash(45.4642, 9.19, 5)).toBe('u0nd9');
  });

  it('defaults to the profile-city precision', () => {
    expect(CITY_GEOHASH_PRECISION).toBe(5);
    expect(encodeGeohash(41.8933, 12.4829)).toBe('sr2yk');
  });

  it('matches the DB check shape: 5 chars of the base32 alphabet', () => {
    const points: Array<[number, number]> = [
      [41.8933, 12.4829],
      [45.4642, 9.19],
      [-33.8688, 151.2093],
      [64.1466, -21.9426],
      [0, 0],
    ];
    for (const [lat, lng] of points) {
      expect(encodeGeohash(lat, lng)).toMatch(/^[0-9b-hjkmnp-z]{5}$/);
    }
  });

  it('honors an explicit precision', () => {
    expect(encodeGeohash(41.8933, 12.4829, 7)).toBe('sr2yk43');
    expect(encodeGeohash(41.8933, 12.4829, 1)).toBe('s');
  });

  it('nearby points share a cell, distant points do not', () => {
    // Two points ~250 m apart in central Milano — same 4.9 km cell.
    expect(encodeGeohash(45.4642, 9.19)).toBe(encodeGeohash(45.465, 9.191));
    expect(encodeGeohash(45.4642, 9.19)).not.toBe(encodeGeohash(41.8933, 12.4829));
  });
});
