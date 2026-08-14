import { z } from 'zod';

/**
 * Mapbox Geocoding v6 forward response — the trust boundary of the city picker
 * (#149). Deliberately minimal: only what the picker renders and stores. The
 * response is external input like any other, so it is parsed, not trusted;
 * `.passthrough()` is avoided and unknown keys are stripped.
 *
 * The picker never sends device location — typed text only — and the selected
 * coordinates are immediately coarsened to a precision-5 geohash by
 * @athanor/core's encodeGeohash before anything is stored.
 */
export const mapboxFeatureSchema = z.object({
  properties: z.object({
    name: z.string().min(1),
    // «Lombardia, Italia» — the disambiguation line under the name.
    place_formatted: z.string().optional(),
  }),
  geometry: z.object({
    // GeoJSON order: [longitude, latitude].
    coordinates: z.tuple([z.number(), z.number()]),
  }),
});

export const mapboxGeocodeResponseSchema = z.object({
  features: z.array(mapboxFeatureSchema),
});

/** What the picker works with: display name, context line, raw coordinates. */
export const citySuggestionSchema = z.object({
  name: z.string().min(1),
  context: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
});

export type MapboxGeocodeResponse = z.infer<typeof mapboxGeocodeResponseSchema>;
export type CitySuggestion = z.infer<typeof citySuggestionSchema>;
