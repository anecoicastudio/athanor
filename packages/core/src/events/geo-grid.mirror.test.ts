import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EVENT_GEO_CELLS_PER_DEGREE } from './geo-grid';

/**
 * #781 — the approximate-location grid exists twice, and the table's copy is the authority.
 *
 *   1. `events_snap_geo` (`20260919124730_event_geo_grid.sql`) — snaps `events.geo` on every write
 *      path, so what is stored is on the grid whoever wrote it
 *   2. `snapToEventGrid` (`geo-grid.ts`) — snaps the fix on the phone, so the precise position
 *      never reaches the OS geocoder or our servers in the first place
 *
 * Both pinning 40 in their own suite would be two independent claims about one number. This reads
 * across the boundary: if the migration's multiplier or divisor and EVENT_GEO_CELLS_PER_DEGREE ever
 * differ, the app would send one grid and the table store another — and a point the app already
 * snapped would be moved again by the trigger, which is the drift the shared spelling exists to rule
 * out. The ROUNDING spelling is pinned too: Postgres `round(float8)` breaks ties to even, so a
 * migration that "simplified" `floor(x * 40 + 0.5)` to `round(x * 40)` would disagree with the app
 * on every exact half-cell.
 */
/**
 * Found by walking UP, not by counting `../` — Stryker runs this suite from a sandbox copy deeper
 * than the package sits in the repo (`ticket-split.mirror.test.ts` carries the full note).
 */
function above(...segments: string[]): string {
  let dir = fileURLToPath(new URL('.', import.meta.url).href);
  for (;;) {
    const candidate = join(dir, ...segments);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no ${segments.join('/')} above this test`);
    dir = parent;
  }
}

const MIGRATION = readFileSync(
  above('supabase', 'migrations', '20260919124730_event_geo_grid.sql'),
  'utf8',
);

/** The trigger's two axis expressions: `floor(extensions.st_<axis>(new.geo…) * N + 0.5) / D`. */
function axisExpression(axis: 'x' | 'y'): { multiplier: number; divisor: number } {
  const match = new RegExp(
    String.raw`floor\(extensions\.st_${axis}\(new\.geo::extensions\.geometry\) \* (\d+) \+ 0\.5\) / (\d+)`,
  ).exec(MIGRATION);
  if (!match) throw new Error(`no floor(st_${axis}(new.geo) * N + 0.5) / N in the migration`);
  return { multiplier: Number(match[1]), divisor: Number(match[2]) };
}

describe('geo grid mirror — events_snap_geo ⇄ snapToEventGrid', () => {
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
    expect(MIGRATION).toMatch(
      /st_point\(\s*floor\(extensions\.st_x\([^)]*\)[^\n]*\n\s*floor\(extensions\.st_y\(/,
    );
  });

  it('never spells the snap with round(), which breaks a float8 tie to even', () => {
    const body = MIGRATION.slice(
      MIGRATION.indexOf('create function public.snap_event_geo()'),
      MIGRATION.indexOf('create trigger events_snap_geo'),
    );
    expect(body).not.toMatch(/\bround\s*\(/);
  });
});
