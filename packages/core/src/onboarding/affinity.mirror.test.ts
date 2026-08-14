import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AFFINITY_WEIGHTS,
  CITY_GEOHASH_MATCH_PRECISION,
  MOMENTO_AFFINITY_THRESHOLD,
  MUTUAL_ACTIVITY_CAP,
  SEEKING_TO_IDENTITY,
} from './affinity';
import { SEEKING_TAGS } from './tags';

/**
 * `affinity.ts` is the source of truth for the seeking → identity map, but the thing
 * that actually ranks Momenti is `athanor.seeking_to_identity()` inside a migration.
 * Two copies in two languages: the failure mode is that someone widens one of them
 * and the nightly matcher keeps scoring the old shape, silently, with every test
 * still green. `packages/schemas/src/password.mirror.test.ts` closes the same class
 * of claim for the auth config.
 *
 * Reads the LAST migration that defines the function rather than a fixed filename —
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

describe('the matcher applies MOMENTO_AFFINITY_THRESHOLD', () => {
  it('run_momenti_matcher filters on affinity >= the constant', () => {
    // The SQL cannot import the constant, so assert the literal it hardcodes. A
    // threshold change that lands in TS alone would otherwise ship a matcher that
    // still proposes on the old bar.
    const sql = currentDefinition('public\\.run_momenti_matcher');
    expect(sql).toMatch(new RegExp(`where affinity >= ${MOMENTO_AFFINITY_THRESHOLD}\\b`));
  });
});

describe('the matcher mirrors AFFINITY_WEIGHTS (#123)', () => {
  // Same contract as the threshold above: the SQL hardcodes each weight as a literal in
  // the affinity expression, so a retune that lands in one language alone fails here.
  it('hardcodes the tag, skill and city weights in the affinity sum', () => {
    const sql = currentDefinition('public\\.run_momenti_matcher');
    expect(sql).toMatch(
      new RegExp(`\\(${AFFINITY_WEIGHTS.tag} \\* \\(coalesce\\(array_length\\(shared`),
    );
    expect(sql).toMatch(
      new RegExp(`\\+ ${AFFINITY_WEIGHTS.skill} \\* coalesce\\(array_length\\(skills_shared`),
    );
    expect(sql).toMatch(new RegExp(`case when city_near then ${AFFINITY_WEIGHTS.city} else 0 end`));
  });
});

describe('mutual activity mirrors core (#361)', () => {
  it('run_momenti_matcher weighs the term at AFFINITY_WEIGHTS.activity, capped at MUTUAL_ACTIVITY_CAP', () => {
    const sql = currentDefinition('public\\.run_momenti_matcher');
    expect(sql).toMatch(
      new RegExp(
        `\\+ ${AFFINITY_WEIGHTS.activity} \\* least\\(${MUTUAL_ACTIVITY_CAP}, coalesce\\(array_length\\(mutual_activity`,
      ),
    );
  });

  it('both functions read verified check-ins, never RSVP intent', () => {
    // The term is «you were both THERE», not «you both clicked going» — event_attendance
    // rows exist only behind an organizer scan of a real ticket. A rewrite that quietly
    // switched to rsvps would make the term free to farm.
    for (const fn of ['public\\.run_momenti_matcher', 'public\\.get_momenti_deck']) {
      const sql = currentDefinition(fn);
      expect(sql).toContain('public.event_attendance');
      expect(sql).not.toContain('public.rsvps');
    }
  });
});

describe('city proximity compares prefixes at CITY_GEOHASH_MATCH_PRECISION (#123)', () => {
  it('run_momenti_matcher truncates both geohashes to the constant', () => {
    const sql = currentDefinition('public\\.run_momenti_matcher');
    expect(sql).toMatch(new RegExp(`left\\(r\\.city_geohash, ${CITY_GEOHASH_MATCH_PRECISION}\\)`));
  });

  it('get_momenti_deck recomputes the term at the same precision', () => {
    const sql = currentDefinition('public\\.get_momenti_deck');
    expect(sql).toMatch(new RegExp(`left\\(me\\.city_geohash, ${CITY_GEOHASH_MATCH_PRECISION}\\)`));
  });
});
