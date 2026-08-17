import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUDIT_LOG_ACTIONS, AUDIT_LOG_FUND_ACTIONS } from './admin';

/**
 * `admin.ts` says its audit-log vocabulary mirrors two CHECK constraints, and until this
 * file nothing enforced that — the same shape of claim `password.mirror.test.ts` closes for
 * the auth config and `packages/core/src/onboarding/affinity.mirror.test.ts` for the
 * matcher's seeking map.
 *
 * The stake is #392 itself: the enum fell twelve actions behind across five migrations, over
 * two days, with every test green the whole time. A pinned list in `admin.test.ts` makes a
 * widening deliberate on OUR side; only this file makes it fail when the DATABASE moves first,
 * which is the direction drift has actually travelled every time.
 *
 * Reads the LAST migration that re-adds each constraint rather than a fixed filename —
 * migrations are append-only and Postgres cannot edit a CHECK in place, so every widening
 * drops and re-adds the constraint whole, and the current list is whichever came last.
 */
/**
 * Found by walking UP from this file, not by counting `../` from it: Stryker runs the suite
 * from a sandbox copy of the package, which sits two levels deeper than the package does in
 * the repo. A fixed relative path resolves to `packages/schemas/supabase/migrations` there and
 * kills the mutation job in its dry run. (`affinity.mirror.test.ts` carries the same note —
 * this is the second time the trap has been worth documenting.)
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

/** The body of the last `add constraint <name> check (...)` in migration order. */
function currentConstraint(name: string): string {
  const pattern = new RegExp(`add constraint ${name} check \\(([\\s\\S]*?)\\n  \\)`);
  const bodies = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8').match(pattern)?.[1])
    .filter((body) => body !== undefined);
  const last = bodies.at(-1);
  if (last === undefined) throw new Error(`no migration adds ${name}`);
  return last;
}

/** The quoted action tokens of the `in (...)` / `not in (...)` list inside a constraint body. */
function actionList(constraint: string): string[] {
  const list = constraint.match(/action (?:not )?in \(([\s\S]*?)\)/)?.[1];
  if (list === undefined) throw new Error('constraint has no action list');
  return [...list.matchAll(/'([a-z_]+)'/g)].map(([, action]) => action!);
}

describe('audit_log_action_check mirrors AUDIT_LOG_ACTIONS', () => {
  it('admits exactly the same actions, in the same order', () => {
    expect(actionList(currentConstraint('audit_log_action_check'))).toEqual([...AUDIT_LOG_ACTIONS]);
  });
});

describe('audit_log_fund_shape mirrors AUDIT_LOG_FUND_ACTIONS', () => {
  it('names exactly the fund half', () => {
    // The split between the two exported lists is not decorative — this constraint is why
    // they are apart, so a moderation action drifting into the fund list (or the reverse)
    // has to fail somewhere, and this is that somewhere.
    expect(actionList(currentConstraint('audit_log_fund_shape'))).toEqual([
      ...AUDIT_LOG_FUND_ACTIONS,
    ]);
  });

  it('still demands the shape auditLogRow refines for', () => {
    // Asserted as SQL text because the refinement in `admin.ts` is a translation of this
    // clause; if the database ever relaxes one of the three, the translation is a lie and
    // the schema starts rejecting rows the table happily holds.
    expect(currentConstraint('audit_log_fund_shape')).toMatch(
      /edition_id is not null and report_id is null and penalty_points is null/,
    );
  });
});
