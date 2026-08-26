// Run via `cd supabase/functions && deno test --allow-env --allow-read .` (CI edge job).
// Needs --allow-read (already in the documented run command).
//
// The deployed edge runtime resolves a module graph by SPECIFIER. It does not honour
// `unstable: ["sloppy-imports"]`, which `supabase/functions/deno.json`, `score-engine/deno.json`
// and `moderation-enforce/deno.json` all enable — so an extension-less specifier resolves
// locally, typechecks locally, passes `deno check` locally, and boots as a 503 BOOT_ERROR on the
// hosted project. `score-engine/index.ts:26-30` documents exactly this and carries three
// hand-written side-effect pins as a belt-and-braces for the CLI's upload walker.
//
// Nothing asserted any of it. The pins were a comment and three import lines: add a module to
// `logic.ts`'s graph whose own imports are extension-less and every test here stays green, the
// deploy reports success, and the Aura engine — the SOLE writer of aura_events, aura_scores and
// stars — answers every cron tick with a 503 nobody is watching for.
//
// #334 framed this as "an unpinned core module goes red". That is no longer the hazard: since
// `packages/core/src/score/*` gained explicit `.ts` on every relative import, a suffixed module
// ships WITHOUT a pin. What is still unguarded, and what this asserts, is the TRANSITIVE
// property the pins only approximate — every specifier reachable from a deployed entrypoint
// carries an extension, however many hops from the entrypoint it sits.
import { assert, assertEquals } from 'jsr:@std/assert@1';
// POSTURE is the hand-maintained table of every function and its auth posture. Importing it
// rather than re-reading the directory is what makes the entrypoint assertion an independent
// pin; `auth-posture.test.ts` imports it for the same reason. Cost: Deno re-registers an
// imported file's tests under each root that pulls it in, so config-invariants' nine tests
// now run three times rather than twice. Milliseconds, and the alternative is a weaker guard.
import { POSTURE } from './config-invariants.test.ts';

const FUNCTIONS = new URL('../', import.meta.url); // _shared/ → supabase/functions/
const REPO = new URL('../../', FUNCTIONS); // → repo root

/** Specifiers the deployed runtime resolves without a file extension. */
const EXTERNAL = /^(npm|jsr|node|https?|data|blob):/;
/** Extensions the deployed runtime will resolve. A bare `./x` is what this file exists to catch. */
const EXTENSIONED = /\.(ts|tsx|js|mjs|cjs|json)$/;

const read = (url: URL) => Deno.readTextFileSync(url);
const rel = (url: URL) => url.pathname.slice(REPO.pathname.length);

/** `imports` from a deno.json, plus the URL relative specifiers in it resolve against. */
function importMap(dir: URL): { imports: Record<string, string>; base: URL } {
  try {
    const parsed = JSON.parse(read(new URL('deno.json', dir))) as {
      imports?: Record<string, string>;
    };
    return { imports: parsed.imports ?? {}, base: dir };
  } catch {
    return { imports: {}, base: dir };
  }
}

/**
 * Every module specifier a source file resolves AT RUNTIME. Comments are stripped first so a
 * commented-out import is not reported, and the match is on the `from` / `import(` clause rather
 * than on a whole statement — an `import { … }` block spanning lines resolves the same either way.
 *
 * `import type` / `export type` statements are dropped: the runtime never sees them, so they can
 * name an extension-less specifier safely and flagging one would be a false positive. This is not
 * a technicality — `packages/core/src/score/stars.ts:1` type-imports `@athanor/schemas`, which
 * maps to `packages/schemas/src/index.ts` whose ~40 re-exports are all extension-less. Deleting
 * the word `type` there is a one-word edit that deploys a 503, and it is the assertions below,
 * not this exemption, that catch it: the statement becomes a runtime edge and the walk follows it.
 *
 * Only the syntactically unambiguous form is erased. `import { STAR_KEYS, type StarKey }` keeps
 * its module edge because it has a value binding, and an all-inline-`type` binding list still
 * emits the import under isolated-modules transpiling — so treating it as a runtime edge is both
 * correct and the conservative direction to be wrong in.
 *
 * The erasure is bounded to ONE statement (`[^;]*?`, not `[\s\S]*?`) because `export type ` also
 * begins a plain type ALIAS. An unbounded span would let an alias swallow every runtime import
 * between it and the next `from '…'` clause, and the failure direction is silent under-reporting
 * — dropped edges are never walked, which is precisely the vacuous pass this file exists to
 * prevent. Four functions already have the alias-then-`from` shape (`announce-cycle/logic.ts`,
 * `close-cycle/logic.ts`, `screen-candidacy/logic.ts`, `erasure-job/logic.ts`) and today survive
 * only because their later `from '…'` occurrences sit inside comments this strips first.
 */
function specifiers(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/\b(?:import|export)\s+type\s[^;]*?\bfrom\s*['"][^'"]+['"]/g, ' ');
  const found: string[] = [];
  const pattern = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(pattern)) found.push(m[1] ?? m[2]);
  return found;
}

type Edge = { importer: string; specifier: string; target: URL };

/**
 * The transitive in-repo module graph of one deployed entrypoint.
 *
 * External specifiers (`npm:`, `jsr:`, `node:`) are not followed — the runtime fetches those and
 * an extension would be wrong. A BARE specifier is followed only when the function's own
 * deno.json, or the functions-root one, maps it to an in-repo path: that is the `@athanor/schemas`
 * alias, which points at `packages/schemas/src/index.ts` whose re-exports are extension-LESS. No
 * deployed source imports it today, so the walk never reaches it — the day one does, the walk
 * follows the alias, sees `export * from './profile'`, and this goes red before the deploy.
 */
function graph(entry: URL, dir: URL) {
  const local = importMap(dir);
  const root = importMap(FUNCTIONS);
  const edges: Edge[] = [];
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as URL;
    if (seen.has(file.href)) continue;
    seen.add(file.href);
    let source: string;
    try {
      source = read(file);
    } catch {
      continue; // a missing target is reported as an edge below, not thrown from the walk
    }
    for (const specifier of specifiers(source)) {
      if (EXTERNAL.test(specifier)) continue;
      let resolved: URL;
      let shipped = specifier;
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        resolved = new URL(specifier, file);
      } else {
        const mapped = local.imports[specifier] ?? root.imports[specifier];
        if (mapped === undefined || EXTERNAL.test(mapped)) continue; // bare + external or unmapped
        const base = local.imports[specifier] !== undefined ? local.base : root.base;
        resolved = new URL(mapped, base);
        shipped = mapped;
      }
      edges.push({ importer: rel(file), specifier: shipped, target: resolved });
      if (EXTENSIONED.test(shipped)) queue.push(resolved);
    }
  }
  return { edges, files: [...seen] };
}

/** Every deployed entrypoint: one `index.ts` per function directory. */
const ENTRYPOINTS = [...Deno.readDirSync(FUNCTIONS)]
  .filter((e) => e.isDirectory && !e.name.startsWith('_') && !e.name.startsWith('.'))
  .map((e) => ({ slug: e.name, dir: new URL(`${e.name}/`, FUNCTIONS) }))
  .filter((f) => {
    try {
      Deno.statSync(new URL('index.ts', f.dir));
      return true;
    } catch {
      return false;
    }
  })
  .sort((a, b) => a.slug.localeCompare(b.slug));

const GRAPHS = ENTRYPOINTS.map((f) => ({
  ...f,
  ...graph(new URL('index.ts', f.dir), f.dir),
}));

// A walker that silently returned nothing would make every assertion below pass vacuously, which
// is the one way a guard like this rots without anyone noticing. So the walk is pinned to content
// first: the entrypoint set against `config-invariants.test.ts`'s POSTURE table — a hand-maintained
// list of every function, which is an INDEPENDENT source rather than a second reading of the same
// directory — and the one graph known to cross the workspace boundary against the modules it must
// contain.
Deno.test('the walk reaches every function POSTURE declares', () => {
  assertEquals(
    ENTRYPOINTS.map((f) => f.slug),
    Object.keys(POSTURE).sort((a, b) => a.localeCompare(b)),
    'every function in the auth-posture table must have a walked index.ts, and vice versa',
  );
  assert(ENTRYPOINTS.length > 15, `implausibly few entrypoints: ${ENTRYPOINTS.length}`);
});

Deno.test('the walk crosses the workspace boundary into packages/core', () => {
  const scoreEngine = GRAPHS.find((g) => g.slug === 'score-engine');
  assert(scoreEngine, 'no score-engine graph');
  const reached = scoreEngine.files.map((href) => rel(new URL(href)));
  // The three hand-written pins AND a module reached only through logic.ts — so a walk that
  // stopped at the entrypoint, or one that followed only side-effect imports, fails here.
  for (const module of [
    'packages/core/src/score/clamp.ts',
    'packages/core/src/score/dampen.ts',
    'packages/core/src/score/weighting.ts',
    'packages/core/src/score/award.ts',
    'packages/core/src/score/weights.ts',
    'packages/schemas/src/aura.ts',
  ]) {
    assert(reached.includes(module), `score-engine's graph never reached ${module}`);
  }
  assert(scoreEngine.edges.length > 20, `implausibly small graph: ${scoreEngine.edges.length}`);
});

Deno.test('every specifier in a deployed graph carries a file extension', () => {
  const bare = GRAPHS.flatMap((g) =>
    g.edges
      .filter((e) => !EXTENSIONED.test(e.specifier))
      .map((e) => `${g.slug}: ${e.importer} imports '${e.specifier}'`),
  );
  assertEquals(
    bare,
    [],
    'extension-less specifiers resolve locally under sloppy-imports and boot as 503 BOOT_ERROR ' +
      `on the hosted project (score-engine/index.ts:26-30):\n  ${bare.join('\n  ')}`,
  );
});

Deno.test('every specifier in a deployed graph resolves to a file that exists', () => {
  // The other half of the same hazard, and what makes a stale hand-written pin visible: a pin
  // left behind by a renamed or deleted module uploads nothing and boots the same 503.
  const missing = GRAPHS.flatMap((g) =>
    g.edges
      .filter((e) => EXTENSIONED.test(e.specifier))
      .filter((e) => {
        try {
          return !Deno.statSync(e.target).isFile;
        } catch {
          return true;
        }
      })
      .map((e) => `${g.slug}: ${e.importer} imports '${e.specifier}' — no such file`),
  );
  assertEquals(missing, [], `dangling module specifiers:\n  ${missing.join('\n  ')}`);
});
