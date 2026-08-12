import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Static audit of the `apps/native/src` tree — seven invariants from CLAUDE.md that no
 * compiler, linter or runtime test can see, because each one fails SILENTLY.
 *
 * Why a test and not a hook: the hex guard in `.claude/settings.json` only *warns*, only
 * inspects Edit/Write payloads, and never sees code arriving via `git pull`, a merge, or a
 * branch someone else wrote. This runs in CI on the tree as it actually is.
 *
 * All seven pass on the tree as of writing. The point is not to find something today, it is
 * to make the next regression loud.
 *
 * `.href` (a string), not the URL object: this app's lib resolves `URL` to the DOM one, which
 * isn't assignable to node's `fileURLToPath` parameter — same idiom as `tokens-mirror.test.ts`.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url).href);
const NATIVE = fileURLToPath(new URL('../..', import.meta.url).href);

/** Repo-relative-ish path for readable failure messages. */
const rel = (p: string) => `apps/native/${p.slice(NATIVE.length)}`;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = `${dir}${name}`;
    if (statSync(p).isDirectory()) walk(`${p}/`, out);
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/**
 * This file necessarily CONTAINS every pattern it hunts for, so scanning itself would make
 * every assertion self-fulfilling. It is excluded by path — the secret patterns below are
 * additionally assembled from fragments so they never appear whole even here.
 */
const SELF = fileURLToPath(new URL(import.meta.url).href);
const FILES = walk(SRC).filter((p) => p !== SELF);
const read = (p: string) => readFileSync(p, 'utf8');
const isTest = (p: string) => /\.test\.tsx?$/.test(p);

/** Every line of a file with its 1-based number, as `[path:line, text]` pairs. */
function lines(p: string): [string, string][] {
  return read(p)
    .split('\n')
    .map((text, i) => [`${rel(p)}:${i + 1}`, text] as [string, string]);
}

/**
 * Replace `//` and block-comment bodies with spaces, preserving length and newlines so line
 * numbers survive. String literals are left intact — callers that must not see string bodies
 * mask them separately. Deliberately naive about regex literals: at worst it masks a little
 * too much, which loses coverage rather than inventing a failure.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let quote = '';
  while (i < src.length) {
    const c = src[i] as string;
    const next = src[i + 1];
    if (quote) {
      if (c === '\\') {
        out += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === quote) quote = '';
      out += c;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// 1 + 2 — environment variables
// ---------------------------------------------------------------------------------------

/**
 * Metro does not give the bundle a `process.env` object; it substitutes each literal
 * `process.env.EXPO_PUBLIC_FOO` member expression with its value at BUNDLE time. So
 * `process.env[name]` — or any computed read — resolves to `undefined` in the shipped app
 * while type-checking, linting and running fine on the dev machine. There is no throw, no
 * warning: the feature just quietly does nothing. This is the single highest-value assertion
 * in the file, and the reason `supabase.ts` spells both key names out longhand.
 */
/**
 * Comments are stripped first throughout this block: `supabase.ts` documents the inlining rule
 * in prose that mentions `process.env.EXPO_PUBLIC_*` verbatim, and a raw grep counts it as a
 * fifth read.
 */
const CODE_LINES = FILES.map((p) => [p, stripComments(read(p)).split('\n')] as const);
const codeLines = (): [string, string][] =>
  CODE_LINES.flatMap(([p, ls]) => ls.map((t, i) => [`${rel(p)}:${i + 1}`, t] as [string, string]));

describe('env reads survive Metro inlining', () => {
  it('never reads process.env with a computed key', () => {
    // `process.env[name]`, and `process.env` handed to a function that will subscript it.
    const dynamic = codeLines().filter(
      ([, t]) => /process\s*\.\s*env\s*\[/.test(t) || /process\s*\.\s*env\s*[),]/.test(t),
    );
    expect(dynamic.map(([where, t]) => `${where}  ${t.trim()}`)).toEqual([]);
  });

  it('never destructures or aliases process.env wholesale', () => {
    // `const { EXPO_PUBLIC_X } = process.env` and `const env = process.env` both defeat
    // inlining exactly like a computed read does.
    const aliased = codeLines().filter(([, t]) =>
      /process\s*\.\s*env(?!\s*\.\s*[A-Za-z_])/.test(t),
    );
    expect(aliased.map(([where, t]) => `${where}  ${t.trim()}`)).toEqual([]);
  });

  it('reads only EXPO_PUBLIC_* names, all declared in .env.example', () => {
    // Anything not prefixed EXPO_PUBLIC_ is stripped from the bundle by Expo, so it is
    // always `undefined` at runtime — and if it were NOT stripped it would be a secret leak.
    const example = readFileSync(`${NATIVE}.env.example`, 'utf8');
    const declared = new Set(
      [...example.matchAll(/^[ \t]*([A-Z0-9_]+)\s*=/gm)].map((m) => m[1] as string),
    );

    const reads = codeLines().flatMap(([where, t]) =>
      [...t.matchAll(/process\s*\.\s*env\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g)].map(
        (m) => [where, m[1] as string] as const,
      ),
    );

    expect(reads.filter(([, name]) => !name.startsWith('EXPO_PUBLIC_'))).toEqual([]);
    expect(
      reads.filter(([, name]) => !declared.has(name)).map(([w, n]) => `${w}  ${n}`),
      'read in code but absent from apps/native/.env.example (EAS builds will boot without it)',
    ).toEqual([]);

    // The names, not the line numbers — this survives the file moving but still makes a NEW
    // env read a deliberate, reviewed edit rather than something that arrives with a merge.
    expect([...new Set(reads.map(([, n]) => n))].sort()).toEqual([
      'EXPO_PUBLIC_SENTRY_DSN',
      'EXPO_PUBLIC_SUPABASE_ANON_KEY',
      'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'EXPO_PUBLIC_SUPABASE_URL',
    ]);
  });
});

// ---------------------------------------------------------------------------------------
// 3 — no server-side secrets in a client bundle
// ---------------------------------------------------------------------------------------

/**
 * Assembled from fragments so this file does not match its own patterns. Everything here is
 * a value that must exist ONLY in `supabase/functions/_shared/supabaseAdmin.ts` or in server
 * job env (CLAUDE.md rule 8) — anything under `apps/native` ships to devices verbatim, and
 * `app.json` / `eas.json` are embedded in the build too.
 */
const SECRET_PATTERNS: [string, RegExp][] = [
  ['supabase secret key', new RegExp(`${'sb'}_${'secret'}_`)],
  ['service role', new RegExp(`${'service'}_${'role'}|${'SERVICE'}_${'ROLE'}`)],
  ['stripe secret key', new RegExp(`\\b${'sk'}_(live|test)_?`)],
  ['stripe restricted key', new RegExp(`\\b${'rk'}_live`)],
  ['stripe secret env', new RegExp(`${'STRIPE'}_${'SECRET'}`)],
];

describe('no server-side secret ever reaches the client bundle', () => {
  const targets = () => [...FILES, `${NATIVE}app.json`, `${NATIVE}eas.json`];

  it.each(SECRET_PATTERNS)('contains no %s', (_label, pattern) => {
    const hits = targets().flatMap((p) =>
      read(p)
        .split('\n')
        .map((t, i) => [`${rel(p)}:${i + 1}`, t] as const)
        .filter(([, t]) => pattern.test(t))
        .map(([where, t]) => `${where}  ${t.trim()}`),
    );
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 4 — @stripe/stripe-react-native must stay out
// ---------------------------------------------------------------------------------------

/**
 * It is a NATIVE module. Adding it means the app can no longer run in App Store Expo Go —
 * the whole reason SDK 54 was chosen (mobile.md). Every payment flow already opens hosted
 * Stripe Checkout from an edge function, so the client never needs a Stripe key at all.
 * Checked in both places because a dependency without an import, or an import without a
 * dependency, are each half of the same mistake.
 */
describe('@stripe/stripe-react-native stays absent', () => {
  const FORBIDDEN = '@stripe/stripe-react-native';

  it('is not a dependency', () => {
    const pkg = JSON.parse(readFileSync(`${NATIVE}package.json`, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const all = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };
    expect(Object.keys(all).filter((n) => n.startsWith('@stripe/'))).toEqual([]);
  });

  it('is not in the import graph', () => {
    const hits = FILES.flatMap((p) =>
      lines(p)
        .filter(([, t]) => t.includes(FORBIDDEN))
        .map(([where]) => where),
    );
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 5 — no literal hex outside comments
// ---------------------------------------------------------------------------------------

/**
 * Rule 4: colours come from `@athanor/config` or Tailwind classes, never a literal. The three
 * hex strings that exist in app code today all sit INSIDE comments documenting contrast math
 * (`MilestoneRow.tsx`, `DateBadge.tsx`, `EventCover.tsx`) — a naive grep fails on all three,
 * which is why the source is comment-stripped first.
 *
 * `*.test.ts(x)` is excluded: `contrast.test.ts` is built out of hex fixtures by design, and
 * a test file is not app code. `global.css` is the token mirror and is covered by
 * `tokens-mirror.test.ts` instead.
 */
describe('no literal hex colours in app code', () => {
  it('every hex in the tree is inside a comment', () => {
    const hits = FILES.filter((p) => !isTest(p)).flatMap((p) => {
      const stripped = stripComments(read(p)).split('\n');
      return stripped
        .map((t, i) => [`${rel(p)}:${i + 1}`, t] as const)
        .filter(([, t]) => /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b/.test(t))
        .map(([where, t]) => `${where}  ${t.trim()}`);
    });
    expect(hits, 'use a token from @athanor/config or a Tailwind class').toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 6 — class-shaped props only on components that resolve them
// ---------------------------------------------------------------------------------------

/**
 * `metro.config.js` sets `globalClassNamePolyfill: false`, so a `className` (or
 * `contentContainerClassName`, …) prop is resolved ONLY by components that go through
 * `useCssElement` — the `src/tw` wrappers, `react-native-css/components`, and `styled()`.
 * On a component imported from `react-native` the prop is an unknown extra: TypeScript stays
 * quiet because `react-native-css/types` widens the RN prop types globally, and native drops
 * the prop without a warning — the element renders, just unstyled (#49, #165 were exactly
 * this, eleven and fourteen sites respectively).
 */

/** Local names bound by value imports from 'react-native' (aliases and `* as` included). */
function rnValueImports(src: string): Set<string> {
  const names = new Set<string>();
  for (const m of src.matchAll(/import\s+([^;]*?)\s+from\s+'react-native'/g)) {
    const clause = m[1] as string;
    if (/^type\s/.test(clause)) continue; // `import type {…}` — types cannot be JSX tags
    for (const part of (clause.match(/{([^}]*)}/)?.[1] ?? '').split(',')) {
      const p = part.trim();
      if (!p || p.startsWith('type ')) continue;
      names.add((p.includes(' as ') ? (p.split(' as ')[1] as string) : p).trim());
    }
    const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)?.[1];
    if (ns) names.add(ns);
  }
  return names;
}

/**
 * Every JSX opening tag with its attribute text, found by walking from `<Tag` to the matching
 * `>` while tracking quotes and brace depth. Naive about nested template-literal edge cases,
 * which at worst widens an attribute window — that can only over-report, never hide a hit.
 */
function jsxOpeningTags(src: string): { base: string; attrs: string; line: number }[] {
  const tags: { base: string; attrs: string; line: number }[] = [];
  const re = /<([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?=[\s/>])/g;
  for (const m of src.matchAll(re)) {
    // matchAll iterates on a CLONE, so `re.lastIndex` never advances — walk from the
    // match itself. Only depth-0 characters land in `attrs`: a render-prop's nested JSX
    // (`renderItem={() => <View className=…>}`) lives inside braces and belongs to the
    // nested tag's own scan, not to this one.
    let i = (m.index as number) + m[0].length;
    let depth = 0;
    let quote = '';
    let attrs = '';
    while (i < src.length) {
      const c = src[i] as string;
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
      attrs += depth === 0 && !quote ? c : ' ';
      i += 1;
    }
    tags.push({
      base: (m[1] as string).split('.')[0] as string,
      attrs,
      line: src.slice(0, m.index).split('\n').length,
    });
  }
  return tags;
}

describe('class-shaped props reach only components that resolve them', () => {
  it('no className-like prop on a JSX tag imported from react-native', () => {
    const hits = FILES.filter((p) => !isTest(p)).flatMap((p) => {
      const src = stripComments(read(p));
      const rn = rnValueImports(src);
      if (rn.size === 0) return [];
      return jsxOpeningTags(src)
        .filter(({ base }) => rn.has(base))
        .filter(({ attrs }) => /\b[A-Za-z]*[cC]lassName\s*=/.test(attrs))
        .map(({ base, line }) => `${rel(p)}:${line}  <${base} …>`);
    });
    expect(
      hits,
      'the prop is silently dropped — use a src/tw wrapper or hoist onto a child',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 7 — rule 3: reaction counts are author-only
// ---------------------------------------------------------------------------------------

/**
 * Rule 3 forbids public vanity metrics. The SERVER side is airtight — `post_reaction_count`
 * and `story_reaction_count` are SECURITY DEFINER and author-gated, asserted in
 * `packages/api`. The CLIENT side is only a JSX conditional plus a query `enabled` flag,
 * i.e. one careless `useQuery` away from rendering a public counter.
 *
 * So this pins the call sites to an explicit allowlist. A THIRD call site — the real failure
 * mode — fails here rather than shipping. Moving one of these on purpose means editing the
 * table below, which is the point: it forces the author-guard question to be re-answered.
 */
const AUTHOR_COUNT_CALLS: Record<string, string> = {
  getAuthorReactionCount: 'app/(modal)/post/[id].tsx',
  getAuthorStoryCount: 'app/(modal)/stories.tsx',
};

/** The i18n keys that render those counts — the render-side twin of the table above. */
const AUTHOR_COUNT_KEYS: Record<string, string> = {
  'post.author.reactions': 'app/(modal)/post/[id].tsx',
  'story.own.stat': 'components/stories/StoriesViewer.tsx',
};

/** `isAuthor`, `isOwn`, … — whatever the guard is called, it must READ as an ownership test. */
const AUTHOR_GUARD = /\bis(Author|Own|Owner|Mine|Me|Self)\b/;

describe('author-only reaction counts (rule 3)', () => {
  it.each(Object.entries(AUTHOR_COUNT_CALLS))('%s is called only from %s', (fn, expected) => {
    const callers = FILES.filter((p) => !isTest(p))
      .filter((p) => read(p).includes(`${fn}(`))
      .map((p) => rel(p).replace('apps/native/src/', ''));
    expect(callers).toEqual([expected]);
  });

  it.each(Object.entries(AUTHOR_COUNT_CALLS))('the %s query is gated on ownership', (fn) => {
    const file = FILES.find((p) => !isTest(p) && read(p).includes(`${fn}(`));
    expect(file, `${fn} has no call site at all`).toBeDefined();
    const src = read(file as string);
    const at = src.indexOf(`${fn}(`);
    const start = src.lastIndexOf('useQuery(', at);
    expect(start, `${fn} is called outside a useQuery — guard it explicitly`).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf('});', at));
    const enabled = block.match(/enabled:\s*([^\n]*)/)?.[1];
    expect(enabled, `the useQuery around ${fn} has no \`enabled\``).toBeDefined();
    // Note the absent `!`: the VIEWER query next door reads `enabled: … && !isAuthor`, so a
    // copy-paste that kept the negation would fetch the count for everyone but the author.
    expect(enabled as string).toMatch(AUTHOR_GUARD);
    expect(enabled as string).not.toMatch(/!\s*is(Author|Own|Owner|Mine|Me|Self)\b/);
  });

  it.each(Object.entries(AUTHOR_COUNT_KEYS))('%s is rendered only in %s', (key, expected) => {
    const users = FILES.filter((p) => !isTest(p))
      .filter((p) => read(p).includes(`'${key}'`))
      .map((p) => rel(p).replace('apps/native/src/', ''));
    expect(users).toEqual([expected]);
  });

  it.each(Object.entries(AUTHOR_COUNT_KEYS))('%s sits inside an ownership branch', (key) => {
    const file = FILES.find((p) => !isTest(p) && read(p).includes(`'${key}'`)) as string;
    const all = read(file).split('\n');
    const at = all.findIndex((t) => t.includes(`'${key}'`));
    // The nearest enclosing conditional. 12 lines is generous for the JSX that wraps it and
    // tight enough that an unguarded sibling branch cannot borrow a distant `isAuthor ?`.
    const window = all.slice(Math.max(0, at - 12), at + 1).join('\n');
    expect(window, `${key} is not visibly behind an ownership check`).toMatch(
      new RegExp(`${AUTHOR_GUARD.source}\\s*(\\?|&&)`),
    );
  });
});
