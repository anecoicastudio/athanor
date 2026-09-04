import { type CitySuggestion, mapboxGeocodeResponseSchema } from '@athanor/schemas';

/**
 * Typed-text city search against Mapbox Geocoding v6 forward (#149). Only the
 * typed query leaves the device — never device location (PRD §4.2 «city
 * (approximate)»; the profile stores a precision-5 geohash of the PICKED
 * suggestion, coarsened client-side by @athanor/core encodeGeohash).
 *
 * The token is a Mapbox PUBLIC token (pk.…, publishable-grade like the
 * Supabase publishable key — never a secret). Metro inlines EXPO_PUBLIC_* at
 * bundle time, so the read below must stay a literal member expression
 * (rules/mobile.md). A missing token degrades the picker to free text — the
 * member still types a city, it just stores no geohash.
 */
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;

export function citySearchAvailable(): boolean {
  return typeof MAPBOX_TOKEN === 'string' && MAPBOX_TOKEN.length > 0;
}

/**
 * `types=place` limits results to city/town-grade features — no addresses, no
 * POIs, which is both the product shape and the privacy shape. No country
 * filter: European cities are in scope (2026-08-14).
 */
export async function searchCities(
  query: string,
  locale: string,
  signal?: AbortSignal,
): Promise<CitySuggestion[]> {
  const q = query.trim();
  if (q.length < 2 || !citySearchAvailable()) return [];

  const url =
    'https://api.mapbox.com/search/geocode/v6/forward' +
    `?q=${encodeURIComponent(q)}` +
    '&types=place&autocomplete=true&limit=5' +
    `&language=${encodeURIComponent(locale)}` +
    `&access_token=${MAPBOX_TOKEN}`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`city search failed: ${res.status}`);

  const parsed = mapboxGeocodeResponseSchema.parse(await res.json());
  return parsed.features.map((f) => ({
    name: f.properties.name,
    context: f.properties.place_formatted ?? null,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));
}
