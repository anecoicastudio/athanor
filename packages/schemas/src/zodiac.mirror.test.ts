import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ZODIAC_SIGNS } from './zodiac.ts';

/**
 * `zodiac.ts` says its twelve keys mirror `profiles_zodiac_sign_check`, and this is what makes
 * that a property rather than a comment — the `audit-log-actions.mirror.test.ts` shape. A key
 * renamed on one side (say, someone "fixing" the Italian keys to English in SQL) would
 * otherwise reach the client as a value `zodiacSignSchema` refuses, and `getOwnProfile` would
 * start throwing on a row the database happily holds.
 *
 * Reads the LAST migration that adds the constraint: migrations are append-only and a CHECK
 * cannot be edited in place, so any widening drops and re-adds it whole.
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

/** The quoted sign tokens of the `zodiac_sign in (...)` list inside the constraint body. */
function signList(constraint: string): string[] {
  const list = constraint.match(/zodiac_sign in \(([\s\S]*?)\)/)?.[1];
  if (list === undefined) throw new Error('constraint has no zodiac_sign list');
  return [...list.matchAll(/'([a-z]+)'/g)].map(([, sign]) => sign!);
}

describe('profiles_zodiac_sign_check mirrors ZODIAC_SIGNS', () => {
  it('admits exactly the same twelve keys, in the same order', () => {
    expect(signList(currentConstraint('profiles_zodiac_sign_check'))).toEqual([...ZODIAC_SIGNS]);
  });

  it('keeps the column nullable in the constraint itself', () => {
    // A pre-#694 member has no date and therefore no sign; the CHECK must let that row be.
    expect(currentConstraint('profiles_zodiac_sign_check')).toMatch(/zodiac_sign is null or/);
  });
});
