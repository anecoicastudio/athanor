/**
 * Shared keyset-pagination plumbing (rule #9: cursor pagination, never offset).
 * Every paginated reader builds the same PostgREST disjunction and the same
 * "full page ⇒ assume more" cursor heuristic — this is the single source for both.
 * Modules keep their own cursor types, page-size constants, and return shapes.
 */

/**
 * PostgREST filter string for a two-column keyset step:
 * rows strictly after the cursor position in (colA, colB) order.
 * `dir` is 'lt' for descending readers, 'gt' for ascending ones.
 * Values are server-issued (ISO timestamps / UUIDs / numeric ranks) — never
 * raw user input, since PostgREST filter strings are not escaped.
 */
export function keysetFilter(
  colA: string,
  colB: string,
  valA: string | number,
  valB: string,
  dir: 'lt' | 'gt',
): string {
  return `${colA}.${dir}.${valA},and(${colA}.eq.${valA},${colB}.${dir}.${valB})`;
}

/**
 * Next-page cursor from a fetched page: a full page means "probably more"
 * (the known nit: an exact-limit final page costs one empty fetch), a short
 * page means done. `toCursor` maps the last row to the module's cursor shape.
 */
export function nextCursorOf<T, C>(
  rows: readonly T[],
  limit: number,
  toCursor: (last: T) => C,
): C | null {
  const last = rows.length === limit ? rows[rows.length - 1] : undefined;
  return last === undefined ? null : toCursor(last);
}
