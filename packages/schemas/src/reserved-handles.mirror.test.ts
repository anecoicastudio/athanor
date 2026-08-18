import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RESERVED_HANDLES, RESERVED_HANDLE_PREFIX } from './reserved-handles';

/**
 * `reserved-handles.ts` says it is the authored home of a list the DATABASE enforces (#430).
 * Nothing but this file makes that true: the constant and the CHECK constraint are two copies,
 * and the copy that matters is the one a client cannot bypass. `audit-log-actions.mirror.test.ts`
 * closes the same shape of claim for the audit vocabulary, and #392 is what happens without it —
 * an enum twelve values behind the database, across five migrations, with every test green.
 *
 * The drift here would be quieter still, because it is silent in the safe direction too: a word
 * added to the TS list and not to the constraint yields a client that says «this handle is
 * reserved» about a handle anyone can claim by not using our client.
 *
 * Reads the LAST migration that adds the constraint rather than a fixed filename — migrations are
 * append-only and Postgres cannot edit a CHECK in place, so widening the list means dropping and
 * re-adding the constraint whole, and the current list is whichever came last.
 */
/**
 * Found by walking UP from this file, not by counting `../`: Stryker runs the suite from a
 * sandbox copy of the package, two levels deeper than the package sits in the repo, where a fixed
 * relative path resolves to `packages/schemas/supabase/migrations` and kills the dry run.
 * (`audit-log-actions.mirror.test.ts` and `affinity.mirror.test.ts` carry the same note.)
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

/** The body of the last `add constraint profiles_handle_not_reserved check (...)` in migration order. */
function currentConstraint(): string {
  const pattern = /add constraint profiles_handle_not_reserved check \(([\s\S]*?)\n {2}\);/;
  const bodies = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8').match(pattern)?.[1])
    .filter((body) => body !== undefined);
  const last = bodies.at(-1);
  if (last === undefined) throw new Error('no migration adds profiles_handle_not_reserved');
  return last;
}

/** The quoted handles of the `<> all (array[...])` list inside the constraint body. */
function reservedList(constraint: string): string[] {
  const list = constraint.match(/<> all \(array\[([\s\S]*?)\]\)/)?.[1];
  if (list === undefined) throw new Error('constraint has no reserved array');
  return [...list.matchAll(/'([a-z0-9_]+)'/g)].map(([, handle]) => handle!);
}

describe('profiles_handle_not_reserved mirrors RESERVED_HANDLES', () => {
  it('refuses exactly the same handles, in the same order', () => {
    expect(reservedList(currentConstraint())).toEqual([...RESERVED_HANDLES]);
  });

  it('carries the brand prefix rule as well as the list', () => {
    // Asserted separately because it is a different mechanism, not a longer list: without it,
    // `athanor_support` passes the constraint while `isReservedHandle` refuses it — the two
    // guards would disagree on the one handle the guard most exists for.
    expect(currentConstraint()).toContain(`handle not like '${RESERVED_HANDLE_PREFIX}%'`);
  });

  it('lets a NULL handle through', () => {
    // `handle_new_user` inserts every profile with handle NULL. A constraint that refused NULL
    // would abort signup, which is a far worse failure than an unclaimed reserved word.
    expect(currentConstraint()).toContain('handle is null');
  });
});
