// scripts/check-comment-rot.mjs
// Comment-rot gate (#886). Two comment shapes go false silently, and both have cost review cycles:
//
//   R1  a LINE-NUMBER citation — `some-file.ts` plus a colon and a line number, or a bare
//       migration version plus a line range. It points at whatever sits on that line today, and
//       nothing re-checks it when the cited file changes. Cite the file plus a symbol or a
//       section instead (`revokeTicket` in `stripe-webhook/handlers.ts`, `docs/PRD.md §4.5`).
//       `§` citations are untouched.
//   R2  an UNDATED PROMISE — «until #N lands», «pending #N», a milestone-coded «TODO(M<n>): …».
//       The issue closes or the milestone ships, and the sentence becomes false with no diff to
//       show it. A promise that is genuinely still open is written with its date,
//       `#N (open as of YYYY-MM-DD)`, which tells the reader it may have expired. Past-tense
//       history («until #784 this was …») does not match, and is meant not to.
//
// Provenance comments («since #273», «#97's ruling») are the decision record and stay — they
// describe what happened, which does not change.
//
// Comments ONLY. `.ts/.tsx/.mjs/.js` are parsed with the TypeScript compiler and every comment
// range is read off the token stream, so a string literal that looks like a citation (an
// assertion message, a `file:line` register key in source-audit.test.ts) is never flagged.
// `.sql` comments (`--` and `/* */`) are extracted by a small lexer that skips `'…'` strings.
//
// Exempt by path: `supabase/migrations/**` — migrations are append-only once applied, so a
// wrong comment there cannot be fixed; `supabase/MIGRATIONS-ERRATA.md` is the fix, and it cites
// migration lines by design. Build output and `node_modules` are skipped.
//
// Allowlist one line with a `rot-ok` token inside a comment on that line, for the rare citation
// that is genuinely load-bearing. It is read off comment text, like `i18n-ignore`.
//
// Roots are overridable by argv — used by the test that pins this file's behaviour against
// fixtures (packages/i18n/src/comment-rot-checker.test.ts), never by CI.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * Trees scanned by default: both apps' source (the `apps/web` directories are the ones
 * `check-i18n-hardcoded.mjs` lists, for the same reason — the app root also holds build output
 * and e2e fixtures), every package's `src`, the edge functions, the pgTAP tests, the staging
 * seed and these scripts. A root that stops existing throws ENOENT from `walk`, the loud failure
 * a silently narrowed scan would not be.
 */
const PACKAGE_ROOTS = readdirSync('packages', { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join('packages', d.name, 'src'))
  .filter((p) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
const DEFAULT_ROOTS = [
  'apps/native/src',
  'apps/web/app',
  'apps/web/components',
  'apps/web/lib',
  'apps/web/utils',
  ...PACKAGE_ROOTS,
  'supabase/functions',
  'supabase/tests',
  'supabase/staging-seed',
  'scripts',
];
const ROOTS = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_ROOTS;

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.open-next',
  '.wrangler',
  '.turbo',
  '.expo',
  'dist',
  'build',
  'coverage',
]);
const EXEMPT_PATH = /(^|\/)supabase\/migrations\//;
const TS_EXT = /\.(?:tsx?|mts|cts|mjs|cjs|js)$/;
const SQL_EXT = /\.sql$/;

/**
 * R1. A repo file with a line suffix (`:12`, `:L12`, `:12-18`, `:12:4`), the `.md L10-11` form,
 * or a bare 14-digit migration version with a line suffix. The extension list is the kinds of
 * file this repo's comments cite; a vendor `.js`/`.d.ts` path pinned to a package version is a
 * different, stable thing and is left alone.
 */
const R1 =
  /\b[\w./[\]()-]+\.(?:tsx?|sql|mjs|md|toml|json)(?::L?\d+(?:-\d+)?|\sL\d+(?:-\d+)?)+\b|\b\d{14}(?::L?\d+(?:-\d+)?)+\b/i;

/**
 * R2. Future-tense promises about an issue, standing «pending/blocked/tracked in #N» forms, a
 * TODO that names an issue, and a milestone-coded TODO (`TODO(M<n>)`) — the
 * milestone letter is a promise about a plan, and plans ship.
 */
const R2 = new RegExp(
  [
    String.raw`\b(?:until|once|when|after)\s+#\d+(?:'s)?\s+(?:lands|ships|merges|closes|is done|gives|writes|adds|moves|lifts|folds|introduces|makes|removes|replaces|wires|schedules)\b`,
    String.raw`\b(?:pending|blocked (?:on|by)|deferred to|tracked in|follow-up(?: in)?|planned for)\s+#\d+`,
    String.raw`\bTODO\b[^\n]*#\d+`,
    String.raw`\bTODO\(M\d`,
  ].join('|'),
  'i',
);
const DATED = /\(open as of \d{4}-\d{2}-\d{2}\)/;
const ALLOW = /\brot-ok\b/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** 1-based line of every newline offset, for turning a comment range into line numbers. */
function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}
function lineOf(starts, pos) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Every comment range in a TS/JS file, as `[start, end)` offsets.
 *
 * Every comment sits in the leading trivia of exactly one token (the end-of-file token included),
 * so reading `getLeadingCommentRanges` at each LEAF token's `pos` finds them all once — JSX
 * `{/* … *\/}` comments included, which hang off the closing brace. Two leaves are skipped:
 * `JsxText`, whose `pos` starts inside rendered text where a `//` is copy, not a comment; and
 * JSDoc nodes, which are themselves comments and would be read twice. A raw `ts.createScanner`
 * loop is NOT a substitute: without the parser's rescans it loses its place after a template
 * literal or a regex and silently misses the rest of the file.
 */
function tsComments(file, text) {
  const kind =
    file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const seen = new Map();
  const visit = (node) => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode)
      return;
    const children = node.getChildren(sf);
    if (children.length === 0) {
      if (node.kind === ts.SyntaxKind.JsxText || node.kind === ts.SyntaxKind.JsxTextAllWhiteSpaces)
        return;
      for (const r of ts.getLeadingCommentRanges(text, node.pos) ?? []) seen.set(r.pos, r.end);
      return;
    }
    for (const child of children) visit(child);
  };
  visit(sf);
  return [...seen.entries()];
}

/**
 * Every comment range in a SQL file. `'…'` strings (with `''` escapes) are skipped; dollar
 * quotes are NOT treated as strings, because in this repo they wrap PL/pgSQL bodies whose `--`
 * comments are comments like any other. `/* *\/` nests, as it does in PostgreSQL.
 */
function sqlComments(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "'") {
      i++;
      while (i < text.length) {
        if (text[i] === "'" && text[i + 1] === "'") i += 2;
        else if (text[i] === "'") {
          i++;
          break;
        } else i++;
      }
    } else if (c === '-' && text[i + 1] === '-') {
      const start = i;
      while (i < text.length && text[i] !== '\n') i++;
      out.push([start, i]);
    } else if (c === '/' && text[i + 1] === '*') {
      const start = i;
      let depth = 0;
      while (i < text.length) {
        if (text[i] === '/' && text[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (text[i] === '*' && text[i + 1] === '/') {
          depth--;
          i += 2;
          if (depth === 0) break;
        } else i++;
      }
      out.push([start, i]);
    } else i++;
  }
  return out;
}

const violations = [];
let scanned = 0;
for (const file of ROOTS.flatMap((root) => [...walk(root)])) {
  if (EXEMPT_PATH.test(file) || file.endsWith('.snap')) continue;
  const isTs = TS_EXT.test(file) && !file.endsWith('.d.ts');
  const isSql = SQL_EXT.test(file);
  if (!isTs && !isSql) continue;
  scanned++;
  const text = readFileSync(file, 'utf8');
  const ranges = isTs ? tsComments(file, text) : sqlComments(text);
  const starts = lineStarts(text);

  // Comment text per source line, so `rot-ok` anywhere in a comment on a line covers the line.
  const byLine = new Map();
  for (const [start, end] of ranges) {
    const first = lineOf(starts, start);
    text
      .slice(start, end)
      .split('\n')
      .forEach((part, k) => byLine.set(first + k, `${byLine.get(first + k) ?? ''} ${part}`));
  }
  for (const [line, comment] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
    if (ALLOW.test(comment)) continue;
    const excerpt = comment.trim().slice(0, 140);
    if (R1.test(comment)) violations.push([file, line, 'R1 line-number citation', excerpt]);
    if (R2.test(comment) && !DATED.test(comment))
      violations.push([file, line, 'R2 undated promise', excerpt]);
  }
}

if (violations.length) {
  const r1 = violations.filter((v) => v[2].startsWith('R1')).length;
  console.error(
    `comments:check FAILED — ${r1} line-number citation(s), ${violations.length - r1} undated promise(s):`,
  );
  for (const [f, ln, rule, txt] of violations) console.error(`  ${f}:${ln}: ${rule}: ${txt}`);
  console.error(
    '\nR1: cite the file plus a symbol or section, never a line number — lines move and nothing re-checks the cite.\n' +
      'R2: write a still-open dependency as `#N (open as of YYYY-MM-DD)`, or rewrite it as history if it landed.\n' +
      'A line that genuinely needs a line number takes a `rot-ok` comment token.',
  );
  process.exit(1);
}
console.log(`comments:check OK — ${scanned} files, no line-number citations or undated promises.`);
