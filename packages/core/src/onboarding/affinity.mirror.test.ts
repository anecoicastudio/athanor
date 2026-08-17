import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AFFINITY_WEIGHTS,
  CITY_GEOHASH_MATCH_PRECISION,
  MOMENTO_AFFINITY_THRESHOLD,
  MUTUAL_ACTIVITY_CAP,
  PROFESSION_COMPLEMENTS,
  SEEKING_TO_IDENTITY,
} from './affinity';
import { PROFESSIONS } from './professions';
import { SEEKING_TAGS } from './tags';

/**
 * The rulings in `affinity.ts` are made in TypeScript; the thing that actually ranks
 * Momenti is SQL. Two copies in two languages: the failure mode is that someone widens
 * one of them and the nightly matcher keeps scoring the old shape, silently, with every
 * test still green. `packages/schemas/src/password.mirror.test.ts` closes the same class
 * of claim for the auth config.
 *
 * Every assertion here compares a VALUE — a parsed map, a parsed constant — against the
 * TypeScript it mirrors. #384 deleted the ones that did not: the weights, the threshold
 * and the geohash precision used to be pinned with regexes over the matcher's arithmetic
 * (`case when city_near then 1 else 0 end`), so reformatting the sum silently unpinned
 * the very number the assertion claimed to guard. They now live in
 * `athanor.momento_affinity_constants()`, which the scoring expression reads, so a
 * drifted value changes what the matcher does rather than only what it looks like.
 *
 * Reads the LAST migration that defines each function rather than a fixed filename —
 * migrations are append-only, so the current body is whichever one came last.
 */
/**
 * Found by walking UP from this file, not by counting `../` from it. Stryker runs the suite
 * from a sandbox copy of the package (`.stryker-tmp/sandbox-N/`), which puts the file two levels
 * deeper than it sits in the repo — a fixed relative path resolves to
 * `packages/core/supabase/migrations`, and the mutation job dies in its dry run before scoring
 * anything. The sandbox is nested inside the repo, so climbing until `supabase/migrations`
 * appears lands on the real one from either location.
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

function currentDefinition(fnName: string): string {
  const bodies = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(`${MIGRATIONS}/${f}`, 'utf8'))
    .filter((sql) => new RegExp(`create (or replace )?function ${fnName}\\b`).test(sql));
  const last = bodies.at(-1);
  if (!last) throw new Error(`no migration defines ${fnName}`);
  // From the create statement to the end of its $$-quoted body.
  const from = last.search(new RegExp(`create (or replace )?function ${fnName}\\b`));
  const rest = last.slice(from);
  const end = rest.indexOf('$$;', rest.indexOf('as $$') + 1);
  return rest.slice(0, end);
}

/** The definition with `--` comment lines removed, so prose never feeds a parser. */
const withoutComments = (sql: string): string =>
  sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

/** The `('seeking', 'identity')` pairs of the VALUES list, as the map they encode. */
function sqlMap(): Record<string, string[]> {
  const sql = currentDefinition('athanor\\.seeking_to_identity');
  const out: Record<string, string[]> = Object.fromEntries(SEEKING_TAGS.map((t) => [t, []]));
  for (const [, seeking, identity] of sql.matchAll(/\('([a-z]+)',\s*'([a-z]+)'\)/g)) {
    (out[seeking!] ??= []).push(identity!);
  }
  for (const key of Object.keys(out)) out[key]!.sort();
  return out;
}

describe('athanor.seeking_to_identity mirrors SEEKING_TO_IDENTITY', () => {
  it('encodes exactly the same pairs', () => {
    const expected = Object.fromEntries(
      Object.entries(SEEKING_TO_IDENTITY).map(([seeking, identities]) => [
        seeking,
        [...identities].sort(),
      ]),
    );
    expect(sqlMap()).toEqual(expected);
  });
});

describe('athanor.profession_complements mirrors PROFESSION_COMPLEMENTS (#361)', () => {
  it('encodes exactly the same pairs', () => {
    // Same contract as the seeking map above: the VALUES list is the SQL copy of the
    // ruled complementarity map, and widening one side alone must fail here. The
    // pattern allows the hyphen `foto-video` carries.
    const sql = currentDefinition('athanor\\.profession_complements');
    const out: Record<string, string[]> = Object.fromEntries(PROFESSIONS.map((p) => [p, []]));
    for (const [, profession, complement] of sql.matchAll(/\('([a-z-]+)',\s*'([a-z-]+)'\)/g)) {
      (out[profession!] ??= []).push(complement!);
    }
    for (const key of Object.keys(out)) out[key]!.sort();

    const expected = Object.fromEntries(
      Object.entries(PROFESSION_COMPLEMENTS).map(([profession, complements]) => [
        profession,
        [...complements].sort(),
      ]),
    );
    expect(out).toEqual(expected);
  });
});

describe('athanor.momento_affinity_constants mirrors the tunables (#384)', () => {
  it('encodes exactly the same values', () => {
    // The `'key', value` arguments of the jsonb_build_object call, read as the object
    // they build. Compared with toEqual, so an added, dropped or retuned key fails —
    // and it fails on the VALUE, which is what the scoring expression reads.
    const sql = withoutComments(currentDefinition('athanor\\.momento_affinity_constants'));
    const out: Record<string, number> = {};
    for (const [, key, value] of sql.matchAll(/'([a-z_]+)',\s*(\d+)/g)) out[key!] = Number(value);

    expect(out).toEqual({
      tag: AFFINITY_WEIGHTS.tag,
      skill: AFFINITY_WEIGHTS.skill,
      city: AFFINITY_WEIGHTS.city,
      activity: AFFINITY_WEIGHTS.activity,
      profession: AFFINITY_WEIGHTS.profession,
      threshold: MOMENTO_AFFINITY_THRESHOLD,
      activity_cap: MUTUAL_ACTIVITY_CAP,
      geohash_precision: CITY_GEOHASH_MATCH_PRECISION,
    });
  });
});

describe('the terms are computed once (#384)', () => {
  it('the matcher and the deck both go through athanor.momento_terms, and neither re-derives a term', () => {
    // The one structural claim `supabase/tests/0122_momento_terms_parity.test.sql`
    // cannot make: parity only catches a second copy once it DISAGREES, and a fresh
    // copy agrees on the day it is written. This catches it on that day instead.
    for (const fn of ['public\\.run_momenti_matcher', 'public\\.get_momenti_deck']) {
      const sql = withoutComments(currentDefinition(fn));
      expect(sql, `${fn} no longer calls athanor.momento_terms`).toContain(
        'athanor.momento_terms(',
      );
      for (const helper of [
        'athanor.tag_intersect',
        'athanor.seeking_to_identity',
        'athanor.profession_complements',
      ]) {
        expect(
          sql,
          `${fn} scores ${helper} itself instead of projecting the shared terms`,
        ).not.toContain(helper);
      }
    }
  });
});
