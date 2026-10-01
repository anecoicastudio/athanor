import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `scripts/check-comment-rot.mjs` is the gate #886 added against the two comment shapes that go
 * false without a diff: a line-number citation and an undated promise. It lives here, beside
 * `hardcoded-checker.test.ts`, because that is where the repo's other root-script checker is
 * pinned, and it reuses that file's shape for the same reasons.
 *
 * Black-box on purpose: CI runs the CLI, so the CLI is the contract. The script takes its roots
 * as arguments precisely so a fixture tree can stand in for the repo.
 *
 * Found by walking UP rather than counting `../`: a test runner may execute the suite from a
 * sandbox copy of the package.
 */
const CHECKER = (() => {
  let dir = fileURLToPath(new URL('.', import.meta.url).href);
  for (;;) {
    const candidate = join(dir, 'scripts', 'check-comment-rot.mjs');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('no scripts/check-comment-rot.mjs above this test');
    dir = parent;
  }
})();

/** Write `files` into a throwaway tree, scan it, and return the checker's own output. */
function scan(files: Record<string, string>): { ok: boolean; report: string } {
  const root = mkdtempSync(join(tmpdir(), 'comment-rot-'));
  for (const [name, body] of Object.entries(files)) {
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body, 'utf8');
  }
  try {
    return {
      ok: true,
      report: execFileSync(process.execPath, [CHECKER, root], { encoding: 'utf8' }),
    };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, report: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('R1 — line-number citations', () => {
  it('fails a file:line cite in a line comment', () => {
    const r = scan({ 'a.ts': '// see handlers.ts:395 for the fence\nexport const x = 1;\n' });
    expect(r.ok).toBe(false);
    expect(r.report).toMatch(/a\.ts:1: R1 line-number citation/);
  });

  it('fails a line range inside a JSDoc block, reporting the line it sits on', () => {
    const r = scan({
      'a.ts': '/**\n * Fine.\n * Mirrors `logic.ts:90-95`.\n */\nexport const x = 1;\n',
    });
    expect(r.ok).toBe(false);
    expect(r.report).toMatch(/a\.ts:3: R1/);
  });

  it('fails a bare migration version with a line suffix', () => {
    const r = scan({ 'a.ts': '// the trigger (20260816073905:366-385) refuses it\n' });
    expect(r.ok).toBe(false);
    expect(r.report).toMatch(/R1/);
  });

  it('fails a JSX comment, which hangs off the closing brace rather than any node', () => {
    const r = scan({
      'a.tsx': 'export const A = () => (\n  <div>\n    {/* per Card.tsx:12 */}\n  </div>\n);\n',
    });
    expect(r.ok).toBe(false);
    expect(r.report).toMatch(/a\.tsx:3: R1/);
  });

  it('fails a SQL -- comment', () => {
    const r = scan({ 'a.test.sql': "-- asserted in handlers.ts:12\nselect 'ok';\n" });
    expect(r.ok).toBe(false);
    expect(r.report).toMatch(/a\.test\.sql:1: R1/);
  });

  it('passes a file + symbol cite and a § cite', () => {
    const r = scan({
      'a.ts': '// `revokeTicket` in stripe-webhook/handlers.ts; docs/PRD.md §4.5\nexport {};\n',
    });
    expect(r.ok).toBe(true);
  });

  it('ignores a citation-shaped STRING literal — only comments are read', () => {
    const r = scan({
      'a.ts': "export const KEY = 'components/StoryRing.tsx:127';\nconst t = `x.ts:${1}`;\n",
    });
    expect(r.ok).toBe(true);
  });

  it('ignores a citation-shaped SQL string literal', () => {
    const r = scan({ 'a.sql': "select 'see logic.ts:12 -- not a comment';\n" });
    expect(r.ok).toBe(true);
  });

  it('keeps its place after a template literal and a regex', () => {
    const r = scan({
      'a.ts':
        'const a = `${1}}`;\nconst b = /\\/\\*/;\n// after both: logic.ts:3\nexport { a, b };\n',
    });
    expect(r.ok).toBe(false);
    expect(r.report).toMatch(/a\.ts:3: R1/);
  });
});

describe('R2 — undated promises', () => {
  it('fails «until #N lands»', () => {
    const r = scan({ 'a.ts': '// null until #220 writes it\nexport {};\n' });
    expect(r.ok).toBe(false);
    expect(r.report).toMatch(/a\.ts:1: R2 undated promise/);
  });

  it('fails a milestone-coded TODO', () => {
    const r = scan({ 'a.ts': '/** TODO(M6): the engine awards the points. */\nexport {};\n' });
    expect(r.ok).toBe(false);
    expect(r.report).toMatch(/R2/);
  });

  it('fails a TODO that names an issue, in SQL too', () => {
    const r = scan({ 'a.sql': '-- TODO: drop this once the backfill runs (#512)\n' });
    expect(r.ok).toBe(false);
    expect(r.report).toMatch(/R2/);
  });

  it('passes a promise dated «(open as of YYYY-MM-DD)»', () => {
    const r = scan({ 'a.ts': '// StoreKit path — pending #672 (open as of 2026-09-26)\n' });
    expect(r.ok).toBe(true);
  });

  it('passes past-tense history', () => {
    const r = scan({ 'a.ts': '// until #784 this was a client write; since #273 it is not\n' });
    expect(r.ok).toBe(true);
  });
});

describe('exemptions', () => {
  it('rot-ok on the line allows one genuinely load-bearing citation', () => {
    const r = scan({ 'a.ts': '// vendor quirk at Pressable.tsx:252 rot-ok\n' });
    expect(r.ok).toBe(true);
  });

  it('rot-ok inside a string does not switch the gate off', () => {
    const r = scan({ 'a.ts': "const s = 'rot-ok'; // see logic.ts:9\n" });
    expect(r.ok).toBe(false);
  });

  it('skips supabase/migrations — append-only, corrected in MIGRATIONS-ERRATA.md instead', () => {
    const r = scan({
      'supabase/migrations/20260101000000_x.sql': '-- when #218 lands, see logic.ts:5\n',
    });
    expect(r.ok).toBe(true);
  });

  it('skips node_modules', () => {
    const r = scan({ 'node_modules/pkg/a.ts': '// see index.ts:1\n' });
    expect(r.ok).toBe(true);
  });
});
