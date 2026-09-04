/**
 * Geohash encoder for the approximate profile city (#149, PRD §4.2 «city
 * (approximate)»). The city picker resolves a selected suggestion's
 * coordinates to a precision-5 cell (≈ 4.9 × 4.9 km) — deliberately coarse.
 * Free-text city stores no geohash; device geolocation is never involved.
 *
 * Standard geohash base32 (Niemeyer): interleaves longitude/latitude bisection
 * bits, 5 bits per character. Alphabet excludes a, i, l, o — the DB CHECK on
 * profiles.city_geohash pins the same shape.
 */
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Cell size at 5: ≈ 4.9 × 4.9 km — city-grade, not street-grade. */
export const CITY_GEOHASH_PRECISION = 5;

export function encodeGeohash(
  lat: number,
  lng: number,
  precision: number = CITY_GEOHASH_PRECISION,
): string {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let evenBit = true;
  let bits = 0;
  let charIndex = 0;
  let hash = '';

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        charIndex = charIndex * 2 + 1;
        lngMin = mid;
      } else {
        charIndex = charIndex * 2;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        charIndex = charIndex * 2 + 1;
        latMin = mid;
      } else {
        charIndex = charIndex * 2;
        latMax = mid;
      }
    }
    evenBit = !evenBit;
    bits += 1;
    if (bits === 5) {
      hash += BASE32[charIndex];
      bits = 0;
      charIndex = 0;
    }
  }

  return hash;
}
