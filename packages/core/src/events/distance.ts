/**
 * metersToKm — pure display formatter for the server-computed distance returned by
 * events_nearby() (frontend 04 §3.1.1 "renders the km as returned"). One decimal,
 * trailing-zero trimmed (2.1 / 5 / 0.4). No I/O; presentation only — the distance is
 * computed server-side (PostGIS), never in the app (no business logic, rule).
 */
export function metersToKm(meters: number): string {
  const km = meters / 1000;
  const rounded = Math.round(km * 10) / 10;
  return String(rounded);
}
