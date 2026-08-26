import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isVersionBelow } from './version';

/**
 * `version.ts` says it is KEPT IN SYNC with the Deno mirror in
 * `supabase/functions/_shared/version-gate.ts`, and until this file the word in the comment
 * was the whole enforcement — the same shape of claim `notification-templates.mirror.test.ts`
 * closes for the push templates and `password.mirror.test.ts` for the auth config.
 *
 * The stake is a force-update gate that disagrees with itself. The client copy decides what
 * the BootGate renders; the Deno copy is the server-side backstop seven edge functions run
 * (`check-in`, the four checkout/session minters, `create-payout-onboarding`,
 * `create-verification-session`). Both are fail-open by contract, so drift does not throw —
 * it silently lets a build through one gate and 426s it at the other, or the reverse, with
 * every existing test green: `version.test.ts` only ever sees the core copy and
 * `version-gate.test.ts` only ever sees the Deno one.
 *
 * ## Compared as text, because the mirror cannot be imported
 *
 * `version-gate.ts:1-2` imports `npm:@supabase/supabase-js@2` and `./respond.ts`, so vitest
 * cannot load it — which is exactly why the two copies were left to review in the first place.
 * The reverse direction is open (`version.ts` has zero imports) but would only prove the two
 * agree on the cases someone thought to write down; comparing the source proves they agree on
 * every case, including the ones nobody enumerated.
 *
 * Comments are stripped before comparing and whitespace is collapsed. The two bodies are
 * byte-identical modulo comments today: the core copy carries two mutant-equivalence notes and
 * a JSDoc line the Deno copy has no reason to. Stripping is therefore what makes the guard
 * assert the thing that matters (the code) instead of the thing that does not (the prose), and
 * collapsing whitespace keeps a prettier pass on one side out of the failure set.
 */
/**
 * Found by walking UP, not by counting `../`: Stryker runs this package's suite from a sandbox
 * copy two levels deeper than the package sits in the repo, where a fixed relative path
 * resolves to `packages/core/supabase/...` and kills the dry run before it scores anything.
 * (`affinity.mirror.test.ts` and `notification-templates.mirror.test.ts` carry the same note.)
 *
 * The segment list for the LOCAL file carries its `packages/core/` prefix on purpose. Stryker
 * mutates `version.ts` and `fees.ts`, so these are the first mirror tests that read a file inside
 * their own mutate glob: the prefix is what makes the climb pass the sandbox and land on the
 * pristine repo copy instead of the instrumented one.
 */
function above(...segments: string[]): string {
  let dir = fileURLToPath(new URL('.', import.meta.url).href);
  for (;;) {
    const candidate = join(dir, ...segments);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no ${segments.join('/')} above this test`);
    dir = parent;
  }
}

const MIRROR = above('supabase', 'functions', '_shared', 'version-gate.ts');
const SELF = above('packages', 'core', 'src', 'boot', 'version.ts');

const MIRROR_SOURCE = readFileSync(MIRROR, 'utf8');
const SELF_SOURCE = readFileSync(SELF, 'utf8');

/**
 * The source of one top-level function, brace to brace. Both files declare these at column 0
 * with indented bodies, so the first `\n}` after the signature is the terminator — no brace
 * counting, and no dependency on either file's ordering.
 */
function declaration(source: string, name: string, where: string): string {
  const start = source.search(new RegExp(`^(export )?function ${name}\\(`, 'm'));
  if (start < 0) throw new Error(`${where} declares no function ${name}`);
  const rest = source.slice(start);
  const end = rest.indexOf('\n}');
  if (end < 0) throw new Error(`${where}'s ${name} has no column-0 closing brace`);
  return rest.slice(0, end + 2);
}

/** Drop comments, collapse whitespace: compare the code, not the prose or the formatting. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('isVersionBelow mirrors supabase/functions/_shared/version-gate.ts', () => {
  // Both halves of every comparison below are extracted by the same regex from two files. If
  // that extraction ever silently yields nothing, `'' === ''` would pass and the guard would be
  // decorative — so each side is pinned to content first, and these are the assertions that
  // make the equality checks mean something.
  it('extracts both copies of both functions, non-empty', () => {
    for (const [where, source] of [
      ['packages/core/src/boot/version.ts', SELF_SOURCE],
      ['supabase/functions/_shared/version-gate.ts', MIRROR_SOURCE],
    ] as const) {
      const compare = code(declaration(source, 'isVersionBelow', where));
      const parse = code(declaration(source, 'parseVersion', where));
      // The fail-open contract and the anchored segment pattern are the two properties a
      // silent-empty extraction would stop guarding, so they are what the sanity check names.
      expect(compare, `${where}: isVersionBelow`).toContain('if (!a || !b) return false;');
      expect(parse, `${where}: parseVersion`).toContain('/^\\d+$/.test(p)');
      expect(compare.length, `${where}: isVersionBelow`).toBeGreaterThan(150);
      expect(parse.length, `${where}: parseVersion`).toBeGreaterThan(100);
    }
  });

  it('isVersionBelow is the same code on both sides', () => {
    expect(code(declaration(MIRROR_SOURCE, 'isVersionBelow', 'the Deno mirror'))).toBe(
      code(declaration(SELF_SOURCE, 'isVersionBelow', 'packages/core')),
    );
  });

  it('parseVersion — the half that decides fail-open — is the same code on both sides', () => {
    expect(code(declaration(MIRROR_SOURCE, 'parseVersion', 'the Deno mirror'))).toBe(
      code(declaration(SELF_SOURCE, 'parseVersion', 'packages/core')),
    );
  });

  it('the mirror still points back here, so the pair stays reviewable', () => {
    expect(MIRROR_SOURCE).toContain('packages/core/src/boot/version.ts');
    expect(SELF_SOURCE).toContain('supabase/functions/_shared/version-gate.ts');
  });

  // Cheap, and it is what the imported copy is FOR: the text comparison proves the two agree,
  // this proves what they agree ON is still the documented contract rather than a shared bug.
  it('the imported copy still fails open and still orders per segment', () => {
    expect(isVersionBelow('1.2.0', '1.10.0')).toBe(true);
    expect(isVersionBelow('1.2', '1.2.0')).toBe(false);
    expect(isVersionBelow(null, '1.0.0')).toBe(false);
    expect(isVersionBelow('1.0.0', 'nonsense')).toBe(false);
  });
});
