import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HANDLE_RENAME_COOLDOWN_DAYS } from './handle-cooldown';

/**
 * `handle-cooldown.ts` says the database's trigger enforces the same window; this makes that a
 * property (the `min-age.mirror.test.ts` shape). The stake: if the app believes 30 days and the
 * trigger 31, the edit form offers a rename on day 30 that the server refuses — a refusal the
 * person was told would not happen.
 *
 * Reads the LAST migration that defines the trigger function — append-only, so the current body
 * is whichever came last.
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

/** The migration minus its `--` comment lines: a header may quote the number, only the body enforces it. */
function code(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

describe('public.profiles_handle_cooldown mirrors HANDLE_RENAME_COOLDOWN_DAYS', () => {
  it('refuses inside the same number of days — read from the refusing statement, not a comment', () => {
    const body = code(currentDefinition('public\\.profiles_handle_cooldown'));
    const days = body.match(/now\(\) < old\.handle_changed_at \+ interval '(\d+) days'/)?.[1];
    expect(days).toBeDefined();
    expect(Number(days)).toBe(HANDLE_RENAME_COOLDOWN_DAYS);
  });

  it('reports the reopening instant with the same interval it refused with', () => {
    // The detail the app formats as «puoi cambiarlo di nuovo il …» must name the same instant the
    // refusal was computed from; a second literal is where the two would drift.
    const body = code(currentDefinition('public\\.profiles_handle_cooldown'));
    const intervals = [...body.matchAll(/interval '(\d+) days'/g)].map((m) => Number(m[1]));
    expect(intervals.length).toBeGreaterThanOrEqual(2);
    expect(new Set(intervals)).toEqual(new Set([HANDLE_RENAME_COOLDOWN_DAYS]));
  });

  it('refuses as PT429 handle_cooldown — the pair @athanor/api reads (HANDLE_COOLDOWN_CODE)', () => {
    // core cannot import @athanor/api, so the two meet at the literal: api's own test pins
    // HANDLE_COOLDOWN_CODE to 'PT429', this pins the trigger to the same code and token. A
    // refusal the app cannot recognise would render as «Riprova» with no date.
    const body = code(currentDefinition('public\\.profiles_handle_cooldown'));
    expect(body).toMatch(/raise exception 'handle_cooldown'\s+using errcode = 'PT429'/);
  });
});
