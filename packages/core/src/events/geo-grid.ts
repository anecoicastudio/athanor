/**
 * The approximate-location grid (#781). An event's point and a «Vicino» search position are
 * snapped to this lattice on the phone, before they reach the OS geocoder or our servers, and
 * `20260919124730_event_geo_grid.sql` snaps `events.geo` to the SAME lattice in a BEFORE INSERT OR
 * UPDATE trigger — the table is the guarantee, this is the copy that keeps the precise fix on the
 * device. `geo-grid.mirror.test.ts` reads the last migration that defines `snap_event_geo()` and
 * fails if the two drift.
 *
 * Forty cells per degree is a 0.025° grid. Play's Data safety form calls a location approximate
 * when it resolves an area of at least 3 km² (Play Console Help, answer 10787469); a 0.025° cell
 * is 5.28 km² at Italy's northernmost point (47.09°N) and 6.29 km² at Lampedusa (35.5°N), and it
 * stays above 3 km² up to roughly 67°N. Cells narrow with cos(latitude), so the bar is met at the
 * north edge, never the south.
 *
 * `floor(x * 40 + 0.5)`, not `Math.round` and not Postgres `round()`: the SQL side must compute
 * the same double from the same text, and Postgres rounds a float8 tie to even while this breaks it
 * upward. Spelled identically on both sides, a point snapped here is left where it is by the trigger.
 */
export const EVENT_GEO_CELLS_PER_DEGREE = 40;

export type GeoPoint = {
  lat: number;
  lng: number;
};

function snap(degrees: number): number {
  return Math.floor(degrees * EVENT_GEO_CELLS_PER_DEGREE + 0.5) / EVENT_GEO_CELLS_PER_DEGREE;
}

/** The grid point nearest to `point`, on both axes. Pure; no I/O. */
export function snapToEventGrid(point: GeoPoint): GeoPoint {
  return { lat: snap(point.lat), lng: snap(point.lng) };
}
