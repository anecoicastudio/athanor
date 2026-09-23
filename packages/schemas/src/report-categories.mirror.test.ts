import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REPORT_CATEGORIES } from './report.ts';

/**
 * `report.ts` says `REPORT_CATEGORIES` mirrors `reports_category_check`. Until #788 nothing
 * enforced it: the CHECK sat unnamed and unchanged in the creating migration for three months,
 * and `report.test.ts` pinned the TypeScript half only. That held while neither side moved. The
 * first widening ('child_safety') is exactly when a one-sided edit would ship — a reason the
 * sheet offers and the database refuses with a 23514 on submit, or the reverse, a reason the
 * database admits and no sheet can file. `report-target-types.mirror.test.ts` closes the same
 * edge for the target type; this is its twin, for the same reason.
 *
 * ORDER is asserted, not only membership: the two lists are read side by side by whoever adds
 * the next reason, and the sheet renders the TypeScript order.
 *
 * Walks UP to `supabase/migrations` rather than counting `../` — Stryker runs this suite from a
 * sandbox two levels deeper than the package (`audit-log-actions.mirror.test.ts` has the note).
 */
const MIGRATIONS = (() => {
  let dir = fileURLToPath(new URL('.', import.meta.url).href);
  for (;;) {
    const candidate = join(dir, 'supabase', 'migrations');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('no supabase/migrations directory above this test');
    dir = parent;
  }
})();

/**
 * The category list of the LAST migration that re-adds `reports_category_check` by name. The
 * creating migration (20260620011307) declares it inline and unnamed, so it is invisible to
 * this search by design; the name exists from 20260923062248 on.
 */
function currentCategories(): string[] {
  const bodies = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map(
      (f) =>
        readFileSync(join(MIGRATIONS, f), 'utf8').match(
          /add constraint reports_category_check[\s\S]*?category in \(([^)]*)\)/,
        )?.[1],
    )
    .filter((body) => body !== undefined);
  const last = bodies.at(-1);
  if (last === undefined) throw new Error('no migration adds reports_category_check');
  return [...last.matchAll(/'([a-z_]+)'/g)].map(([, value]) => value!);
}

describe('reports_category_check mirrors REPORT_CATEGORIES', () => {
  it('admits exactly the reasons the schema declares, in the same order', () => {
    expect(currentCategories()).toEqual([...REPORT_CATEGORIES]);
  });

  it("includes 'child_safety' on both sides (#788)", () => {
    expect(currentCategories()).toContain('child_safety');
    expect([...REPORT_CATEGORIES]).toContain('child_safety');
  });
});
