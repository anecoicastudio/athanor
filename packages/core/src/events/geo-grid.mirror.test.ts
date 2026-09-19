import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EVENT_GEO_CELLS_PER_DEGREE } from './geo-grid';

/**
 * #781 — the approximate-location grid exists twice, and the table's copy is the authority.
 *
 *   1. `public.snap_event_geo()`, fired by the `events_snap_geo` trigger — snaps `events.geo` on
 *      every write path, so what is stored is on the grid whoever wrote it
 *   2. `snapToEventGrid` (`geo-grid.ts`) — snaps the fix on the phone, so the precise position
 *      never reaches the OS geocoder or our servers in the first place
 *
 * Both pinning 40 in their own suite would be two independent claims about one number. This reads
 * across the boundary: if the trigger's multiplier or divisor and EVENT_GEO_CELLS_PER_DEGREE ever
 * differ, the app would send one grid and the table store another — and a point the app already
 * snapped would be moved again by the trigger, which is the drift the shared spelling exists to rule
 * out. The ROUNDING spelling is pinned too: Postgres `round(float8)` breaks ties to even, so a body
 * that "simplified" `floor(x * 40 + 0.5)` to `round(x * 40)` would disagree with the app on every
 * exact half-cell.
 *
 * Reads the LAST migration that defines the function (the `min-age.mirror.test.ts` shape):
 * migrations are append-only, so a changed grid arrives as a new `create or replace`, never as an
 * edit to `20260919124730_event_geo_grid.sql`.
 */
const MIGRATIONS = (() => {
  // Walk UP rather than count `../`: Stryker runs from a sandbox copy two levels deeper.
  let dir = fileURLToPath(new URL('.', import.meta.url).href);
  for (;;) {
    const candidate = join(dir, 'supabase', 'migrations');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('no supabase/migrations directory above this test');
    dir = parent;
  }
})();

/** The migration minus its `--` comment lines: a header may quote the grid, only the body snaps. */
function code(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

/** The body of the current `public.snap_event_geo()` — from the last migration that defines it. */
const BODY = (() => {
  const define = /create (?:or replace )?function public\.snap_event_geo\(\)/;
  const last = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => code(readFileSync(join(MIGRATIONS, f), 'utf8')))
    .filter((sql) => define.test(sql))
    .at(-1);
  if (!last) throw new Error('no migration defines public.snap_event_geo()');
  const from = last.search(define);
  const open = last.indexOf('$$', from);
  const close = last.indexOf('$$', open + 2);
  if (open < 0 || close < 0) throw new Error('snap_event_geo() has no $$-quoted body');
  return last.slice(open + 2, close);
})();

/** The trigger's axis expression: `floor(extensions.st_<axis>(new.geo…) * N + 0.5) / D`. */
function axisExpression(axis: 'x' | 'y'): { multiplier: number; divisor: number } {
  const match = new RegExp(
    String.raw`floor\(extensions\.st_${axis}\(new\.geo::extensions\.geometry\) \* (\d+) \+ 0\.5\) / (\d+)`,
  ).exec(BODY);
  if (!match) throw new Error(`no floor(st_${axis}(new.geo) * N + 0.5) / N in snap_event_geo()`);
  return { multiplier: Number(match[1]), divisor: Number(match[2]) };
}

describe('geo grid mirror — snap_event_geo() ⇄ snapToEventGrid', () => {
  it('snaps the longitude (st_x) with the app’s cells-per-degree', () => {
    expect(axisExpression('x')).toEqual({
      multiplier: EVENT_GEO_CELLS_PER_DEGREE,
      divisor: EVENT_GEO_CELLS_PER_DEGREE,
    });
  });

  it('snaps the latitude (st_y) with the app’s cells-per-degree', () => {
    expect(axisExpression('y')).toEqual({
      multiplier: EVENT_GEO_CELLS_PER_DEGREE,
      divisor: EVENT_GEO_CELLS_PER_DEGREE,
    });
  });

  it('builds the point as st_point(longitude, latitude) — x first, as create_event does', () => {
    expect(BODY).toMatch(
      /st_point\(\s*floor\(extensions\.st_x\([^)]*\)[^\n]*\n\s*floor\(extensions\.st_y\(/,
    );
  });

  it('never spells the snap with round(), which breaks a float8 tie to even', () => {
    expect(BODY).not.toMatch(/\bround\s*\(/);
  });
});
