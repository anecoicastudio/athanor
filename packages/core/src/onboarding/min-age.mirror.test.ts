import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MIN_MEMBER_AGE } from '../profile/age';

/**
 * `age.ts` says the migration's guard mirrors MIN_MEMBER_AGE; this is what makes that a
 * property (the `affinity.mirror.test.ts` shape). The stake: the funnel refuses early with
 * a friendly line, the trigger refuses late with 23514 — if the two thresholds drift, a
 * member the funnel admitted gets an unexplained failure at the flush, and the draft loops.
 *
 * Reads the LAST migration that defines the guard — append-only, so the current body is
 * whichever came last.
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

function currentDefinition(fnName: string): string {
  const bodies = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .filter((sql) => new RegExp(`create (or replace )?function ${fnName}\\b`).test(sql));
  const last = bodies.at(-1);
  if (!last) throw new Error(`no migration defines ${fnName}`);
  return last;
}

describe('athanor.profiles_birth_date_guard mirrors MIN_MEMBER_AGE', () => {
  it('refuses at the same number of years', () => {
    const sql = currentDefinition('athanor\\.profiles_birth_date_guard');
    const years = sql.match(/interval '(\d+) years'/)?.[1];
    expect(years).toBeDefined();
    expect(Number(years)).toBe(MIN_MEMBER_AGE);
  });

  it('refuses with check_violation, the code the funnel’s flush treats as a hard stop', () => {
    const sql = currentDefinition('athanor\\.profiles_birth_date_guard');
    expect(sql).toMatch(/errcode = 'check_violation'/);
  });
});
