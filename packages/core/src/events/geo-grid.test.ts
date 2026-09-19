import { describe, expect, it } from 'vitest';
import { EVENT_GEO_CELLS_PER_DEGREE, snapToEventGrid } from './geo-grid';

describe('EVENT_GEO_CELLS_PER_DEGREE', () => {
  it('is forty cells per degree — a 0.025° grid', () => {
    expect(EVENT_GEO_CELLS_PER_DEGREE).toBe(40);
  });
});

describe('snapToEventGrid', () => {
  it('snaps a Milan fix to the nearest 0.025° lattice point on both axes', () => {
    expect(snapToEventGrid({ lat: 45.46421, lng: 9.19034 })).toEqual({ lat: 45.475, lng: 9.2 });
  });

  it('rounds down when the point sits below the half-cell', () => {
    expect(snapToEventGrid({ lat: 45.4624, lng: 9.1874 })).toEqual({ lat: 45.45, lng: 9.175 });
  });

  it('breaks an exact half-cell tie upward on both hemispheres, as floor(x * 40 + 0.5) does', () => {
    // 0.0625 is 1/16, exactly representable, and exactly 2.5 cells — a true tie. Postgres
    // `round(float8)` breaks ties to even (→ 0.05), so the SQL side spells it with floor too.
    expect(snapToEventGrid({ lat: 0.0625, lng: 0.0625 })).toEqual({ lat: 0.075, lng: 0.075 });
    expect(snapToEventGrid({ lat: -0.0625, lng: -0.0625 })).toEqual({ lat: -0.05, lng: -0.05 });
  });

  it('snaps southern and western coordinates to the same lattice', () => {
    expect(snapToEventGrid({ lat: -33.86882, lng: -70.64827 })).toEqual({
      lat: -33.875,
      lng: -70.65,
    });
  });

  it('keeps each axis independent — a latitude never leaks into the longitude', () => {
    expect(snapToEventGrid({ lat: 41.9028, lng: 12.4964 })).toEqual({ lat: 41.9, lng: 12.5 });
  });

  it('never moves a point by more than half a cell on either axis', () => {
    const halfCell = 1 / (2 * EVENT_GEO_CELLS_PER_DEGREE);
    for (let i = 0; i <= 2000; i++) {
      const lat = -89 + i * 0.08901;
      const lng = -179 + i * 0.17903;
      const snapped = snapToEventGrid({ lat, lng });
      expect(Math.abs(snapped.lat - lat)).toBeLessThanOrEqual(halfCell);
      expect(Math.abs(snapped.lng - lng)).toBeLessThanOrEqual(halfCell);
    }
  });

  it('is idempotent — a snapped point is already on the grid', () => {
    for (let i = 0; i <= 2000; i++) {
      const once = snapToEventGrid({ lat: -89 + i * 0.08901, lng: -179 + i * 0.17903 });
      expect(snapToEventGrid(once)).toEqual(once);
    }
  });

  it('lands every result on a multiple of the grid step', () => {
    for (let i = 0; i <= 500; i++) {
      const { lat, lng } = snapToEventGrid({ lat: 35 + i * 0.0243, lng: 6 + i * 0.0371 });
      expect(Number.isInteger(Math.round(lat * EVENT_GEO_CELLS_PER_DEGREE * 1e6) / 1e6)).toBe(true);
      expect(Number.isInteger(Math.round(lng * EVENT_GEO_CELLS_PER_DEGREE * 1e6) / 1e6)).toBe(true);
    }
  });
});
