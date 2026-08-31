import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REPORT_TARGET_TYPES } from './report.ts';
import { adminReportRow } from './admin.ts';

/**
 * `report.ts` says `REPORT_TARGET_TYPES` mirrors `reports_target_type_check`, and until #574
 * nothing enforced it — the same unenforced claim `audit-log-actions.mirror.test.ts` closes
 * for the audit vocabulary, and for the same reason: `admin.test.ts` makes a widening
 * deliberate on OUR side, and only a file like this one fails when the DATABASE moves first.
 *
 * #574 is what that costs. The CHECK admitted three target types, the panel's enum re-declared
 * the same three, and the two agreed — right up until a fourth was needed, at which point the
 * agreement had to be maintained by hand in three places (the migration, `report.ts`,
 * `admin.ts`) with nothing to say when one was missed. The re-declaration is gone now
 * (`adminReportRow.target_type` IS `reportTargetType`), and this closes the remaining edge:
 * the one between TypeScript and SQL.
 *
 * ORDER is asserted, not just membership. The two lists are read side by side by anyone adding
 * a fifth type, and a set-equal test would let them drift into different orders and quietly
 * stop being readable as the same list.
 */

/**
 * Found by walking UP from this file, not by counting `../`: Stryker runs the suite from a
 * sandbox copy of the package, two levels deeper than the package sits in the repo, where a
 * fixed relative path resolves to `packages/schemas/supabase/migrations` and kills the
 * mutation job in its dry run. (`audit-log-actions.mirror.test.ts` carries the same note.)
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
 * The target-type list of the LAST migration that names `reports_target_type_check`.
 *
 * Migrations are append-only and Postgres cannot edit a CHECK in place, so every widening
 * drops and re-adds the constraint whole and the current definition is whichever came last in
 * filename order. The creating migration (20260620011307) declares the constraint INLINE and
 * unnamed, so it is invisible to this search by design — the name only exists from the
 * migration that first spells it, which is also the first one that could be wrong.
 */
function currentTargetTypes(): string[] {
  const bodies = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map(
      (f) =>
        readFileSync(join(MIGRATIONS, f), 'utf8').match(
          /constraint reports_target_type_check[\s\S]*?target_type in \(([^)]*)\)/,
        )?.[1],
    )
    .filter((body) => body !== undefined);
  const last = bodies.at(-1);
  if (last === undefined) throw new Error('no migration names reports_target_type_check');
  return [...last.matchAll(/'([a-z]+)'/g)].map(([, value]) => value!);
}

describe('reports_target_type_check mirrors REPORT_TARGET_TYPES', () => {
  it('admits exactly the vocabulary the schema declares, in the same order', () => {
    expect(currentTargetTypes()).toEqual([...REPORT_TARGET_TYPES]);
  });

  it("includes 'message' on both sides — a report can name a chat message (#574)", () => {
    expect(currentTargetTypes()).toContain('message');
    expect([...REPORT_TARGET_TYPES]).toContain('message');
  });

  it('is the same list the admin queue parses — one enum, not a copy of one', () => {
    expect(adminReportRow.shape.target_type.options).toEqual(currentTargetTypes());
  });
});
