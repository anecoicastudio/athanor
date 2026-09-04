import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUDIT_LOG_ACTIONS } from './admin.ts';

/**
 * Third link in the same chain. `audit-log-actions.mirror.test.ts` pins the vocabulary to the
 * database's CHECK; this file pins it to the two i18n catalogs, because an action the schema
 * admits and the catalogs have never heard of renders as its own raw key — `screen_reopen` on
 * an operator's screen.
 *
 * That is not hypothetical: #420 existed because the catalogs sat six actions deep while the
 * CHECK reached eighteen, and the only reason nobody saw it is that no admin surface renders a
 * fund row yet. The vocabulary has widened across five migrations already and will again, so
 * the widening has to fail here too, not just against the SQL.
 *
 * Reads the catalogs from disk rather than importing `@athanor/i18n`: `packages/schemas` is the
 * base of the dependency graph and gains nothing by taking an edge on a package that sits above
 * it. The migration mirror reads `.sql` from disk for the same reason, and the walk-up below is
 * that file's, verbatim and for its reason — Stryker runs the suite from a sandbox copy two
 * levels deeper than the package sits in the repo, so a fixed relative path resolves nowhere.
 */
const CATALOGS = (() => {
  let dir = fileURLToPath(new URL('.', import.meta.url).href);
  for (;;) {
    const candidate = join(dir, 'packages', 'i18n', 'src', 'catalogs');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('no packages/i18n/src/catalogs directory above this test');
    dir = parent;
  }
})();

function catalog(locale: 'it' | 'en'): Record<string, string> {
  return JSON.parse(readFileSync(join(CATALOGS, `${locale}.json`), 'utf8')) as Record<
    string,
    string
  >;
}

describe('every audit action has an admin.action.* label', () => {
  it.each(['it', 'en'] as const)('%s names all of them', (locale) => {
    const keys = catalog(locale);
    const missing = AUDIT_LOG_ACTIONS.filter((action) => keys[`admin.action.${action}`] == null);
    expect(missing).toEqual([]);
  });

  it.each(['it', 'en'] as const)('%s names nothing the vocabulary dropped', (locale) => {
    // The other direction, and the one a widening never catches: an action removed from the
    // CHECK leaves its label behind, and a stale label is how a retired action keeps looking
    // supported. Orphans are cheap to find only while the keys are flat (rules/i18n.md).
    // Widened to `readonly string[]` deliberately: `AUDIT_LOG_ACTIONS` is a tuple of literals,
    // so `.includes()` on it refuses a plain string — which is exactly the value a catalog key
    // yields, and exactly the value this direction has to test.
    const vocabulary: readonly string[] = AUDIT_LOG_ACTIONS;
    const labelled = Object.keys(catalog(locale))
      .filter((key) => key.startsWith('admin.action.'))
      .map((key) => key.slice('admin.action.'.length));
    expect(labelled.filter((action) => !vocabulary.includes(action))).toEqual([]);
  });

  it('labels are not the key echoed back', () => {
    // `t()` returns the key itself for a missing key (#113), so a label accidentally set to
    // its own key would satisfy the presence check above while rendering exactly the failure
    // it is meant to prevent.
    const it_ = catalog('it');
    const en = catalog('en');
    for (const action of AUDIT_LOG_ACTIONS) {
      const key = `admin.action.${action}`;
      expect(it_[key]).not.toBe(key);
      expect(en[key]).not.toBe(key);
    }
  });
});
