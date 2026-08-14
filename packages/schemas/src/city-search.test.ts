import { describe, expect, it } from 'vitest';
import { citySuggestionSchema, mapboxGeocodeResponseSchema } from './city-search';

const mapboxResponse = {
  type: 'FeatureCollection',
  features: [
    {
      id: 'x',
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [9.19, 45.4642] },
      properties: {
        mapbox_id: 'abc',
        feature_type: 'place',
        name: 'Milano',
        place_formatted: 'Lombardia, Italia',
      },
    },
  ],
};

describe('mapboxGeocodeResponseSchema', () => {
  it('parses a v6 forward response, stripping what the picker never reads', () => {
    const parsed = mapboxGeocodeResponseSchema.parse(mapboxResponse);
    expect(parsed.features).toHaveLength(1);
    const feature = parsed.features[0];
    expect(feature?.properties.name).toBe('Milano');
    expect(feature?.geometry.coordinates).toEqual([9.19, 45.4642]);
    expect(feature).not.toHaveProperty('id');
  });

  it('accepts a feature without place_formatted', () => {
    const bare = {
      features: [{ properties: { name: 'Roma' }, geometry: { coordinates: [12.4829, 41.8933] } }],
    };
    expect(mapboxGeocodeResponseSchema.parse(bare).features[0]?.properties.place_formatted).toBe(
      undefined,
    );
  });

  it('rejects a feature with malformed coordinates', () => {
    const bad = {
      features: [{ properties: { name: 'Roma' }, geometry: { coordinates: [12.4829] } }],
    };
    expect(() => mapboxGeocodeResponseSchema.parse(bad)).toThrow();
  });
});

describe('citySuggestionSchema', () => {
  it('holds what the picker renders and stores', () => {
    const s = citySuggestionSchema.parse({
      name: 'Milano',
      context: 'Lombardia, Italia',
      lat: 45.4642,
      lng: 9.19,
    });
    expect(s.name).toBe('Milano');
  });

  it('rejects a blank name', () => {
    expect(() => citySuggestionSchema.parse({ name: '', context: null, lat: 0, lng: 0 })).toThrow();
  });
});
