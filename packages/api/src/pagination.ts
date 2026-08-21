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

/**
 * The opaque `${created_at}|${id}` cursor the admin readers hand to their pages, decoded.
 * A half cursor is refused: the cursor is server-issued, so a missing half is a caller bug.
 * The report queue learned this the hard way — interpolating it built the literal filter
 * `id.lt.undefined` (PostgREST then failed on the uuid), and silently dropping the predicate
 * would restart a moderator's queue at page 1 without a word, the failure that looks like it
 * worked. `label` names the reader in the error (`malformed report cursor: …`).
 */
export function decodeCursor(cursor: string, label: string): { ts: string; id: string } {
  const [ts, id] = cursor.split('|');
  if (!ts || !id) throw new Error(`malformed ${label} cursor: ${cursor}`);
  return { ts, id };
}

/**
 * The limit+1 probe: a reader asks for one row beyond its page to learn whether a next page
 * exists, and never returns that row — leaking it would show an operator a row that appears
 * again at the top of the next page, in the cursor as well as in the list.
 */
export function probePage<T>(raw: readonly T[], limit: number): { page: T[]; hasMore: boolean } {
  const hasMore = raw.length > limit;
  return { page: hasMore ? raw.slice(0, limit) : [...raw], hasMore };
}

/**
 * The cursor for the page after this one, from the page's last RAW row — not its last parsed
 * one, because a withheld tail row would move the cursor backwards and serve the next page
 * overlapping this one (showing the same row twice while still hiding the bad one).
 *
 * `null` when the probe saw nothing further, and `null` when the tail row does not carry both
 * halves as strings. The second case is real: when the web app runs ahead of the production
 * migration (#335), the old `admin_list_waitlist` still answers, without `id` — every row is
 * withheld, and a cursor of `…|undefined` would pass `decodeCursor` only to fail inside the
 * database. No cursor means no "load more" into a page that cannot exist.
 */
export function tailCursor(page: readonly unknown[], hasMore: boolean): string | null {
  const last = page[page.length - 1];
  if (!hasMore || typeof last !== 'object' || last === null) return null;
  const { created_at, id } = last as { created_at?: unknown; id?: unknown };
  return typeof created_at === 'string' && typeof id === 'string' ? `${created_at}|${id}` : null;
}
