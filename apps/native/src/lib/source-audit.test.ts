import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Static audit of the `apps/native/src` tree — invariants from CLAUDE.md and closed issues
 * that no compiler, linter or runtime test can see, because each one fails SILENTLY.
 *
 * Why a test and not a hook: the hex guard in `.claude/settings.json` only *warns*, only
 * inspects Edit/Write payloads, and never sees code arriving via `git pull`, a merge, or a
 * branch someone else wrote. This runs in CI on the tree as it actually is.
 *
 * All of them pass on the tree as of writing. The point is not to find something today, it
 * is to make the next regression loud.
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

/**
 * `app.config.ts` (#486) is evaluated by Node at config time, not bundled by Metro, so the two
 * inlining rules below do not bind it — a computed read there would resolve fine. The
 * `.env.example` rule does bind it: it reads EXPO_PUBLIC_SITE_ORIGIN to decide which host the
 * binary claims as a universal link, and an EAS build missing that variable resolves a
 * different host from the one `links.ts` hands URLs out on — silently, which is #486 itself.
 * Its build-time-only names (the Firebase config path, #746) are pinned by the carve-out below
 * instead, because they are neither EXPO_PUBLIC_ nor public.
 */
const BUILD_TIME_CONFIG = `${NATIVE}app.config.ts`;
const configLines = (): [string, string][] =>
  stripComments(read(BUILD_TIME_CONFIG))
    .split('\n')
    .map((t, i) => [`${rel(BUILD_TIME_CONFIG)}:${i + 1}`, t] as [string, string]);

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

  it('reads only EXPO_PUBLIC_* names, all declared in .env.example (build-time config aside)', () => {
    // Anything not prefixed EXPO_PUBLIC_ is stripped from the bundle by Expo, so it is
    // always `undefined` at runtime — and if it were NOT stripped it would be a secret leak.
    const example = readFileSync(`${NATIVE}.env.example`, 'utf8');
    const declared = new Set(
      [...example.matchAll(/^[ \t]*([A-Z0-9_]+)\s*=/gm)].map((m) => m[1] as string),
    );

    const allReads = [...codeLines(), ...configLines()].flatMap(([where, t]) =>
      [...t.matchAll(/process\s*\.\s*env\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g)].map(
        (m) => [where, m[1] as string] as const,
      ),
    );

    // The one carve-out: names that exist only while a build runs and that app.config.ts reads
    // at config time (#746). They are NOT EXPO_PUBLIC_ — EAS materialises GOOGLE_SERVICES_JSON
    // as a secret file variable and sets EAS_BUILD_PLATFORM itself — and they are not in
    // `.env.example`, which holds public values only. So they may appear in app.config.ts and
    // in the tests that drive it, and never in code that ships: in the bundle they would be
    // `undefined`, or, if ever inlined, a build machine's path. Pinned, so a new one is a
    // reviewed edit here.
    const BUILD_TIME_ONLY = ['EAS_BUILD_PLATFORM', 'GOOGLE_SERVICES_JSON'];
    const buildTime = allReads.filter(([, name]) => BUILD_TIME_ONLY.includes(name));
    expect(
      buildTime
        .filter(([where]) => !where.startsWith(`${rel(BUILD_TIME_CONFIG)}:`))
        .filter(([where]) => !/\.test\.tsx?:\d+$/.test(where))
        .map(([w, n]) => `${w}  ${n}`),
      'a build-time name read by shipped code',
    ).toEqual([]);
    expect(
      [
        ...new Set(
          buildTime
            .filter(([where]) => where.startsWith(`${rel(BUILD_TIME_CONFIG)}:`))
            .map(([, n]) => n),
        ),
      ].sort(),
    ).toEqual(BUILD_TIME_ONLY);

    const reads = allReads.filter(([, name]) => !BUILD_TIME_ONLY.includes(name));
    expect(reads.filter(([, name]) => !name.startsWith('EXPO_PUBLIC_'))).toEqual([]);
    expect(
      reads.filter(([, name]) => !declared.has(name)).map(([w, n]) => `${w}  ${n}`),
      'read in code but absent from apps/native/.env.example (EAS builds will boot without it)',
    ).toEqual([]);

    // The names, not the line numbers — this survives the file moving but still makes a NEW
    // env read a deliberate, reviewed edit rather than something that arrives with a merge.
    expect([...new Set(reads.map(([, n]) => n))].sort()).toEqual([
      'EXPO_PUBLIC_APP_VARIANT',
      'EXPO_PUBLIC_MAPBOX_TOKEN',
      'EXPO_PUBLIC_SENTRY_DSN',
      'EXPO_PUBLIC_SITE_ORIGIN',
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
  // #466 enabled the Sentry symbol upload, which puts an auth token in the release workflow for
  // the first time. Nothing here had a Sentry shape, and CI's bundle-leak grep never will: the
  // token is build-time and not EXPO_PUBLIC_*, so it cannot reach the JS bundle it greps. This
  // file scans eas.json and app.json, which is exactly where one would land.
  ['sentry auth token', new RegExp(`${'sntry'}[su]_`)],
  // What the Sentry config plugin writes into sentry.properties if handed an `authToken` prop.
  ['sentry properties token', new RegExp(`${'auth'}\\.${'token'}\\s*=`)],
];

describe('no server-side secret ever reaches the client bundle', () => {
  const targets = () => [...FILES, `${NATIVE}app.json`, `${NATIVE}eas.json`, BUILD_TIME_CONFIG];

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
 * the whole reason this app tracks the SDK Expo Go ships (mobile.md). Every payment flow
 * already opens hosted Stripe Checkout from an edge function, so the client never needs a
 * Stripe key at all.
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
 *
 * ## The one exempt file (#539)
 *
 * `components/provider-marks.tsx` carries literal hex values and is allowed to. They are
 * Google's and Apple's brand colours, not ours: DESIGN §6's third-party carve-out requires a vendor's mark
 * to ship in its mandated form — full colour, unmodified — and explicitly forbids recolouring
 * it to `currentColor` or to anything else. Routing them through `@athanor/config` would
 * not satisfy rule #4 either; it would only hide a vendor's colour inside our token table,
 * which `tokens-mirror.test.ts` would then have to mirror into `global.css` as if it were a
 * brand colour of ours.
 *
 * The exemption is by PATH and it is bounded on the other side: one file against the vendors'
 * literals, and `provider-marks-mirror.test.ts` asserts that every hex in the file is in a vendor
 * asset — so the carve-out cannot become a place to park a colour. A second exempt
 * path is not a thing to add; a second vendor mark is transcribed into this same file.
 */
const VENDOR_MARKS = `${SRC}components/provider-marks.tsx`;

describe('no literal hex colours in app code', () => {
  it('every hex in the tree is inside a comment', () => {
    const hits = FILES.filter((p) => !isTest(p) && p !== VENDOR_MARKS).flatMap((p) => {
      const stripped = stripComments(read(p)).split('\n');
      return stripped
        .map((t, i) => [`${rel(p)}:${i + 1}`, t] as const)
        .filter(([, t]) => /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b/.test(t))
        .map(([where, t]) => `${where}  ${t.trim()}`);
    });
    expect(hits, 'use a token from @athanor/config or a Tailwind class').toEqual([]);
  });

  it('the one exempt path still names a file', () => {
    // A rename would turn the exemption into a filter that matches nothing. That direction is
    // loud (the renamed file's vendor hexes fail the assertion above), but the message
    // would send the next reader hunting for a rule violation instead of a stale path.
    expect(
      FILES.includes(VENDOR_MARKS),
      'the literal-hex exemption points at components/provider-marks.tsx and that file is gone. ' +
        'If the vendor marks moved, move this path with them (#539).',
    ).toBe(true);
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
function jsxOpeningTags(src: string): { base: string; attrs: string; raw: string; line: number }[] {
  const tags: { base: string; attrs: string; raw: string; line: number }[] = [];
  const re = /<([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?=[\s/>])/g;
  for (const m of src.matchAll(re)) {
    // matchAll iterates on a CLONE, so `re.lastIndex` never advances — walk from the
    // match itself. Only depth-0 characters land in `attrs`: a render-prop's nested JSX
    // (`renderItem={() => <View className=…>}`) lives inside braces and belongs to the
    // nested tag's own scan, not to this one.
    let i = (m.index as number) + m[0].length;
    const start = i;
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
      // The same window UNBLANKED. `attrs` masks brace contents, which is what §6 wants and
      // what §22 cannot use: `accessible={false}` blanks to `accessible=` and `onPress={onClose}`
      // to `onPress=`, so both of the attributes §22 reads survive only here. §21's `nestedTags`
      // makes the same distinction in its own walk and says so in as many words.
      raw: src.slice(start, i),
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

// ---------------------------------------------------------------------------------------
// 8 — keyboard avoidance goes through the one hook (#163, #616)
// ---------------------------------------------------------------------------------------

/**
 * Five composers had each copied `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`
 * — overshooting inside an iOS sheet (no measured offset) and inert on Android, where an
 * undefined behavior disables the component entirely. #163 replaced them with one measured
 * wrapper; #616 found the measurement itself was taken once, at mount, and so was wrong on
 * exactly the screen that needed it most (a sheet pushed from a sheet).
 *
 * The mechanism is now `hooks/use-keyboard-inset.ts`: it reads the keyboard's height from
 * the event and pads by it — no measurement. `KeyboardAvoidingView` is therefore gone from
 * the app — the first assertion pins its ABSENCE, not an allowlist, because a call site reaching for it again is the regression
 * this section exists to catch. The second keeps the old copied branch out even so, since a
 * reintroduction would most likely arrive in that shape. The third pins the new single point
 * of truth: nothing else subscribes to keyboard show/hide, so nobody hand-rolls avoidance at
 * a call site again. The last pins #765: both lifted surfaces drop their bottom safe-area
 * edge by the ONE platform rule, `keyboardCoversBottomInset`, rather than each deciding.
 */
describe('keyboard avoidance goes through the one hook (#163, #616)', () => {
  const INSET_CONSUMERS = [
    'components/KeyboardAvoiding.tsx',
    'components/stories/StoriesViewer.tsx',
  ];

  it('KeyboardAvoidingView is referenced nowhere in the app', () => {
    const users = FILES.filter((p) => !isTest(p))
      .filter((p) => stripComments(read(p)).includes('KeyboardAvoidingView'))
      .map((p) => rel(p).replace('apps/native/src/', ''))
      .sort();
    expect(users).toEqual([]);
  });

  it('no Android-inert keyboard behavior (a `: undefined` branch) anywhere', () => {
    // Comment-stripped: the hook's own docblock quotes the forbidden pattern to explain it.
    const hits = CODE_LINES.flatMap(([p, stripped]) =>
      stripped
        .map((text, i) => [`${rel(p)}:${i + 1}`, text] as const)
        .filter(([, t]) => /behavior=\{[^}]*\?\s*'padding'\s*:\s*undefined\}/.test(t))
        .map(([where]) => where),
    );
    expect(hits).toEqual([]);
  });

  it('only the hook subscribes to keyboard show/hide', () => {
    const subscribers = FILES.filter((p) => !isTest(p))
      .filter((p) => stripComments(read(p)).includes('Keyboard.addListener('))
      .map((p) => rel(p).replace('apps/native/src/', ''))
      .sort();
    expect(subscribers).toEqual(['hooks/use-keyboard-inset.ts']);
  });

  it('the keyboard inset hook has exactly the wrapper and the stories overlay as consumers', () => {
    const users = FILES.filter((p) => !isTest(p))
      .filter((p) => rel(p) !== 'apps/native/src/hooks/use-keyboard-inset.ts')
      .filter((p) => stripComments(read(p)).includes('useKeyboardInset'))
      .map((p) => rel(p).replace('apps/native/src/', ''))
      .sort();
    expect(users).toEqual([...INSET_CONSUMERS].sort());
  });

  it('a lifted view drops its bottom safe-area edge by the one platform rule (#765)', () => {
    // The native SafeAreaView pads by the provider's inset whatever the view's position, so
    // without these the home indicator is reserved on top of an iOS keyboard (34pt dead band).
    const screen = stripComments(read(`${SRC}components/Screen.tsx`));
    expect(screen).toMatch(/const lifted = useLiftedOverBottomInset\(\);/);
    expect(screen).toMatch(/edges: lifted \? \['top'\] : \['top', 'bottom'\]/);
    const wrapper = stripComments(read(`${SRC}components/KeyboardAvoiding.tsx`));
    expect(wrapper).toMatch(/value=\{inset > 0 && keyboardCoversBottomInset\}/);
    const stories = stripComments(read(`${SRC}components/stories/StoriesViewer.tsx`));
    expect(stories).toMatch(
      /edges=\{keyboardInset > 0 && keyboardCoversBottomInset \? \[\] : \['bottom'\]\}/,
    );
  });
});

// ---------------------------------------------------------------------------------------
// 9 — a screen that HOLDS a pick with no frame must be able to draw it (#318, #460, #154)
// ---------------------------------------------------------------------------------------

/**
 * An RN `<Image>` handed a video file URI renders nothing — no error, no placeholder, just a
 * blank 160×160 box with a corner glyph. Both composers shipped exactly that, and both were
 * fixed one at a time (#318 for post-compose, #460 for story-compose): the same sweep missed
 * twice, which is what this section exists to make loud the third time.
 *
 * The discovery rule is «holds a pick in state». `grid.tsx` and `ProfileView.tsx` also open a
 * video-capable MediaSheet, but they hand the pick straight to `addMoment` and never draw it,
 * so they have nothing to branch on and no `<Image>` at all. A screen that KEEPS a
 * `PickedMedia` draws it — and a video has no frame to draw, so it owes the no-poster surface
 * that `media.noPoster.video` announces.
 *
 * **Audio joined the union in #154 and is the same defect with a worse hit rate.** A video at
 * least *has* frames somewhere; a recording can never have one, so `<Image source={{uri}}/>`
 * over an `.m4a` is a blank box on every single item rather than on the ones without a poster.
 * The kind is only offered where a bucket can store it — `post-compose` alone — so the audio
 * assertions are scoped to the holders that can actually receive one, which keeps
 * `story-compose` from being asked for copy about a kind its sheet never offers.
 */
describe('a held pick with no frame never draws through <Image> (#318, #460, #154)', () => {
  const HOLDERS = FILES.filter((p) => !isTest(p)).filter((p) =>
    /useState<[^>]*PickedMedia/.test(stripComments(read(p))),
  );
  /** The holders whose MediaSheet actually offers the recorder — audio can only land here. */
  const AUDIO_HOLDERS = HOLDERS.filter((p) => /\ballowAudio\b/.test(stripComments(read(p))));

  it('every composer that holds a pick names the no-poster surface', () => {
    expect(HOLDERS.length, 'no composer holds PickedMedia — has the state moved?').toBeGreaterThan(
      0,
    );
    const missing = HOLDERS.filter((p) => !read(p).includes("'media.noPoster.video'")).map(rel);
    expect(missing, 'a held video draws nothing — give it the no-poster fill + label').toEqual([]);
  });

  it('every composer that can hold a RECORDING names its surface too (#154)', () => {
    // Scoped to allowAudio holders rather than all of them: a composer whose sheet never
    // offers the recorder cannot receive an audio pick, and demanding copy for a kind it
    // cannot hold would be the guard inventing a requirement.
    expect(
      AUDIO_HOLDERS.length,
      'no composer offers the recorder — has allowAudio moved, or been dropped?',
    ).toBeGreaterThan(0);
    const missing = AUDIO_HOLDERS.filter((p) => !read(p).includes("'media.noPoster.audio'")).map(
      rel,
    );
    expect(
      missing,
      'a held recording draws nothing at all — an <Image> over an .m4a has no frame to find, ' +
        'on every item rather than only the ones without a poster. Give it its own tile.',
    ).toEqual([]);
  });

  it('the kind branch comes BEFORE the drawing surface, not after it', () => {
    // Comment-stripped: both files quote `<Image>` in the prose explaining this very branch.
    const late = HOLDERS.filter((p) => {
      const src = stripComments(read(p));
      const image = src.indexOf('<Image');
      const branch = src.indexOf("kind === 'video'");
      return image === -1 || branch === -1 || branch > image;
    }).map(rel);
    expect(late, 'decide on media.kind first — a ▶ badge over a blank box is the bug').toEqual([]);
  });

  it('the audio branch comes BEFORE the drawing surface too (#154)', () => {
    const late = AUDIO_HOLDERS.filter((p) => {
      const src = stripComments(read(p));
      const image = src.indexOf('<Image');
      const branch = src.indexOf("kind === 'audio'");
      return image === -1 || branch === -1 || branch > image;
    }).map(rel);
    expect(
      late,
      'a recording that reaches <Image> renders nothing — branch on the kind first',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 10 — every poster extraction is bounded, and every swallowed failure is named (#462)
// ---------------------------------------------------------------------------------------

/**
 * `extractVideoPoster` has no timeout of its own — neither `replaceAsync` nor
 * `generateThumbnailsAsync` is bounded (`MEDIA_LIMITS.VIDEO_POSTER_TIMEOUT_MS` documents why)
 * — and every caller awaits it while the video is ALREADY in Storage. So an unbounded
 * extraction never delays a success; it hides one, which reads to the member exactly like a
 * failure. Bounding it is the caller's job, and two of the three callers did not do it.
 *
 * This is generalised deliberately. The equivalent assertions in `candidacy-video-status.test.ts`
 * name ONE file explicitly — no glob, no walk — which is precisely why the moment and post paths
 * kept the unbounded shape through #412 and #449 without anything going red. This walks the
 * tree, so the next caller is a test failure rather than a human rereading the pipeline.
 *
 * The scope is «calls `extractVideoPoster`», not «lives under media/»: `use-story-upload.ts`
 * has a bare catch too, but it wraps a best-effort rollback and story segments have no poster
 * step at all (`story_segments` has no `thumb_path`), so it is outside this rule by construction
 * rather than by allowlist.
 */
const POSTER_CALLERS: Record<string, string> = {
  'lib/media/use-candidacy-upload.ts': 'candidacy.poster',
  'lib/media/use-moment-upload.ts': 'moment.poster',
  'app/(modal)/post-compose.tsx': 'post.poster',
};

describe('poster extraction is bounded and never discarded unnamed (#462)', () => {
  /** `poster.ts` declares the function; a call site is anything else that names it. */
  const DEFINER = 'lib/media/poster.ts';
  const callers = FILES.filter((p) => !isTest(p))
    .filter((p) => stripComments(read(p)).includes('extractVideoPoster('))
    .map((p) => rel(p).replace('apps/native/src/', ''))
    .filter((p) => p !== DEFINER)
    .sort();

  it('the call sites are exactly the ones this section checks', () => {
    // A new caller must be added to the table above, which is the point: it forces the
    // bounded/named question to be answered once per path instead of never.
    expect(callers).toEqual(Object.keys(POSTER_CALLERS).sort());
  });

  it.each(Object.entries(POSTER_CALLERS))('%s bounds the wait and cancels the work', (file) => {
    const source = read(`${SRC}${file}`);
    expect(source, `${file} awaits an unbounded extraction`).toContain('withTimeout(');
    expect(source).toContain('VIDEO_POSTER_TIMEOUT_MS');
    // `withTimeout` abandons by design; without `onTimeout` the decoder keeps running and
    // holding its bitmaps long after the caller stopped listening (#449).
    expect(source, `${file} stops waiting but never stops the work`).toContain('onTimeout:');
    expect(source).toMatch(/\.abort\(\)/);
  });

  it.each(Object.entries(POSTER_CALLERS))('%s names what it swallowed', (file, scope) => {
    const source = read(`${SRC}${file}`);
    // Swallowing is correct here — failing a publish because a decoder would not give up a
    // frame trades a working post for a missing one. Discarding the REASON is not.
    expect(source, `${file} has a bare catch {} — bind the error and name it`).not.toMatch(
      /\}\s*catch\s*\{/,
    );
    expect(source).toContain(`devWarn('${scope}'`);
  });
});

// ---------------------------------------------------------------------------------------
// 11 — transient feedback is a Toast, not a single-OK Alert (#102)
// ---------------------------------------------------------------------------------------

/**
 * `Alert.alert(msg)` with no button array is a toast wearing a modal: it stops the screen,
 * demands a tap, and covers the very region the feedback refers to. Since #117 there is a
 * global host, so the alternative costs one `useToast()` call — which is why the shape kept
 * reappearing on screens written after #102 was filed (it named three; two more had grown by
 * the time it was worked).
 *
 * This is NOT a blanket ban, and the register below is the point rather than a loophole.
 * `plan.tsx` and `annual.tsx` argue the opposite case in prose at the call site and the
 * argument holds — a refusal that is news about money, or that has no inline slot to land in,
 * is acknowledged rather than caught in the 2.5s a toast holds; `progress.tsx` is plan's
 * sibling on the same ledger and inherits it. Note how narrow the exemption is even there:
 * both fund screens toast their *client-side* validation misses (`fund.plan.error.incomplete`,
 * `fund.progress.error.empty`) and spend the Alert only on a server refusal. A new bare
 * `Alert.alert` fails this and forces that distinction to be drawn once, here, not never.
 */
const SINGLE_OK_ALERTS: Record<string, string> = {
  'app/(modal)/annual.tsx':
    'a ballot card has no slot for a sentence, so the refusal needs one (#382)',
  'app/(modal)/plan.tsx': 'a server refusal about money is acknowledged, not held for 2.5s',
  'app/(modal)/progress.tsx': 'same: a refusal on the realization ledger is news about money',
};

/**
 * 1-based line of every `Alert.alert(` whose argument list carries no top-level comma — i.e. a
 * lone message with no button array. Paren/brace depth and string quotes are tracked, so a
 * comma inside `t('k', locale)` or inside the copy itself does not count. Deliberately naive
 * about `${}` in a template literal: no call site uses one, and the failure mode is to read a
 * two-argument alert as single-OK, which over-reports rather than inventing silence.
 */
function singleOkAlerts(src: string): number[] {
  const CALL = 'Alert.alert(';
  const out: number[] = [];
  for (let at = src.indexOf(CALL); at !== -1; at = src.indexOf(CALL, at + 1)) {
    let depth = 0;
    let quote = '';
    let comma = false;
    for (let i = at + CALL.length; i < src.length; i += 1) {
      const c = src[i] as string;
      if (quote) {
        if (c === '\\') i += 1;
        else if (c === quote) quote = '';
        continue;
      }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' && depth === 0) break;
      else if (c === ')' || c === ']' || c === '}') depth -= 1;
      else if (c === ',' && depth === 0) {
        comma = true;
        break;
      }
    }
    if (!comma) out.push(src.slice(0, at).split('\n').length);
  }
  return out;
}

describe('transient feedback goes through the toast host (#102)', () => {
  it('the screens that announce through a bare Alert are exactly the exempt ones', () => {
    const sites = FILES.filter((p) => !isTest(p)).flatMap((p) =>
      singleOkAlerts(stripComments(read(p))).map(
        (line) => `${rel(p).replace('apps/native/src/', '')}:${line}`,
      ),
    );
    const users = [...new Set(sites.map((s) => s.slice(0, s.lastIndexOf(':'))))].sort();
    const stray = sites.filter((s) => !(s.slice(0, s.lastIndexOf(':')) in SINGLE_OK_ALERTS));
    const register = Object.entries(SINGLE_OK_ALERTS)
      .map(([file, why]) => `  ${file} — ${why}`)
      .join('\n');
    expect(
      users,
      `single-OK Alert.alert outside the register:\n  ${stray.join('\n  ')}\n` +
        `Announce with useToast().showToast(...), or register the screen above with the ` +
        `reason it must block.\nRegistered exemptions:\n${register}`,
    ).toEqual(Object.keys(SINGLE_OK_ALERTS).sort());
  });
});

// ---------------------------------------------------------------------------------------
// 12 — the toast band clears chrome that OVERLAYS the content, not just a footer (#102)
// ---------------------------------------------------------------------------------------

/**
 * `Screen footer` reserves space below the content, so the band clears a pinned action bar by
 * construction (#117). A full-bleed screen cannot use it: the story viewer's composer and dream
 * CTA float OVER the story, and moving them into a footer would put the story behind the bar
 * instead of under it — the `bg-background/70` chrome would reveal the Screen background rather
 * than the photo. So the viewer measures its bar and the viewport lifts the band by that much.
 *
 * Measured rather than a constant on purpose: the composer grows with a multi-line draft and the
 * keyboard lifts it, which is exactly when a hardcoded offset would be wrong. That is also why
 * this is asserted as a WIRING CHAIN — every link is invisible on its own, and dropping any one
 * of them silently restores the ~24pt overlap that #102's own fix introduced.
 */
describe('the full-bleed viewer lifts the toast band over its overlay chrome (#102)', () => {
  const host = () => read(`${SRC}components/ToastHost.tsx`);
  const screen = () => read(`${SRC}components/Screen.tsx`);

  it('the viewport actually applies the inset it accepts', () => {
    expect(host(), 'ToastViewport takes bottomInset but never positions with it').toMatch(
      /bottom:\s*bottomInset/,
    );
  });

  it('Screen forwards its toastInset to the viewport', () => {
    // Screen is the only thing that mounts a viewport, so a dropped prop here silently
    // pins every band back to the screen edge.
    expect(screen()).toMatch(/<ToastViewport\s+bottomInset=\{toastInset\}\s*\/>/);
  });

  it.each(
    FILES.filter((p) => !isTest(p))
      .filter((p) => p !== `${SRC}components/stories/StoriesViewer.tsx`)
      .filter((p) => stripComments(read(p)).includes('<StoriesViewer'))
      .map((p) => rel(p).replace('apps/native/src/', '')),
  )('%s measures the viewer chrome and hands it to Screen', (file) => {
    const source = stripComments(read(`${SRC}${file}`));
    expect(source, `${file} mounts the viewer without measuring its overlay chrome`).toContain(
      'onChromeHeight=',
    );
    expect(source, `${file} measures the chrome but never lifts the toast band`).toMatch(
      /toastInset=\{/,
    );
  });
});

// ---------------------------------------------------------------------------------------
// 13 — every crash-trail marker is awaited, or justified in place (#488)
// ---------------------------------------------------------------------------------------

/**
 * `markStep`'s contract is that its write has RESOLVED before the native boundary it marks —
 * `lib/crash-trail.ts` states it outright: "So `await markStep(…)` means the bytes are on disk."
 * A fire-and-forget marker dies with the process exactly like a queued console line, so it is a
 * no-op in the one case the trail exists for. That contract was broken once already, in the PR
 * that introduced it: `boot.fonts` was fired and forgotten immediately before
 * `SplashScreen.hideAsync()` — the very boundary it marks — and nothing went red. No type error,
 * no lint warning, no failing test, and no missing marker until an unreproducible crash hands
 * back a trail that stops one step early.
 *
 * Lint cannot close this, for two independent reasons. `apps/native/eslint.config.js` is
 * `eslint-config-expo/flat` plus an `ignores` block and nothing else — the React-Compiler
 * rule-severity block that used to sit beside it is gone, its sweep done (#691) — so
 * `@typescript-eslint/no-floating-promises` — configured only in
 * `packages/config/eslint/library.js`, which this app does not extend — is not running here at
 * all. And even where it runs it defaults to `ignoreVoid: true`, so `void markStep(…)` satisfies
 * it; `void` is precisely the form both the deliberate sites and the accidental one take.
 *
 * So the rule cannot be "never `void` a marker": two call sites legitimately do, because a
 * synchronous `AppState` listener cannot await and iOS leaves seconds of runway after
 * `didEnterBackground`. It has to tell JUSTIFIED apart from ACCIDENTAL, and that is what the
 * `crash-trail:void-ok` line marker and the register below do together — the marker makes the
 * decision visible where the call is, the register makes it cost a sentence somewhere a reviewer
 * reads. Both are required and the set is pinned, so widening the exemption and quietly dropping
 * one are equally loud.
 *
 * Test files are deliberately out of scope. A test that forgets to await a marker asserts against
 * a store that has not been written and fails as a test, loudly, in the same run — which is the
 * failure mode this section exists to manufacture for shipped code, not one it needs to
 * manufacture again. `isTest` is also how every other section here scopes itself, and
 * `crash-trail.test.ts` uses forms a call-form rule would have to grow special cases for
 * (`const marking = markStep(…).then(…)`, `first.markStep(…)`) without buying anything.
 */

/** `crash-trail.ts` declares `markStep`; a call site is anything else that names it. */
const TRAIL_DEFINER = `${SRC}lib/crash-trail.ts`;

/** What a deliberately un-awaited marker must carry, on the call's own line. */
const VOID_OK = 'crash-trail:void-ok';

/**
 * The complete register of markers that may be fired and forgotten, keyed `<file>#<step>` so it
 * survives the lines moving and so one file can hold both an awaited marker and an exempt one.
 * A `void markStep` outside this table fails; a listed site that loses its `crash-trail:void-ok`
 * fails too, so removing an exemption is as visible as adding one.
 */
const VOID_MARKERS: Record<string, string> = {
  'components/boot/CrashTrailGate.tsx#app.background':
    'a synchronous AppState listener cannot await, and iOS leaves seconds of runway after didEnterBackground',
  'components/boot/CrashTrailGate.tsx#app.active':
    'same listener, same constraint — and unlike the media markers there is no native call to get in front of',
};

type MarkStepCall = { line: number; form: string; step: string };

/**
 * Every `markStep(` in comment-stripped source, with the keyword that consumes it and the step it
 * writes. The keyword is the identifier immediately to its left, so a bare call reports an empty
 * form rather than being missed — the whole point is that the accidental shape is the one with
 * nothing in front of it. A `.` or a longer identifier to the left means a different binding
 * (`first.markStep(`), which is skipped.
 *
 * Only `await` counts as consumption, deliberately. `return markStep(…)` hands the promise to a
 * caller who may well await it, and would pass a laxer rule — but «may well» is the reasoning that
 * lost `boot.fonts`, and there is no such call site to accommodate. A form that is genuinely fine
 * gets registered like any other, which costs one sentence and makes the reasoning readable.
 *
 * The step argument is read up to the first `)`, which is naive about a computed argument — no
 * call site has one, and the failure mode is a key that matches no register entry, i.e. a loud
 * failure rather than a silent pass.
 */
function markStepCalls(src: string): MarkStepCall[] {
  const CALL = 'markStep(';
  const out: MarkStepCall[] = [];
  for (let at = src.indexOf(CALL); at !== -1; at = src.indexOf(CALL, at + 1)) {
    const before = src.slice(0, at);
    if (/[.$\w]$/.test(before)) continue;
    const end = src.indexOf(')', at + CALL.length);
    const arg = end === -1 ? '' : src.slice(at + CALL.length, end).trim();
    out.push({
      line: before.split('\n').length,
      form: /([A-Za-z]+)\s*$/.exec(before)?.[1] ?? '',
      step: /^'([\w.]+)'$/.exec(arg)?.[1] ?? arg,
    });
  }
  return out;
}

describe('a crash-trail marker is awaited, or justified in place (#488)', () => {
  const sites = FILES.filter((p) => !isTest(p))
    .filter((p) => p !== TRAIL_DEFINER)
    .flatMap((p) => {
      const raw = read(p).split('\n');
      const file = rel(p).replace('apps/native/src/', '');
      return markStepCalls(stripComments(read(p))).map((c) => ({
        at: `${file}:${c.line}`,
        key: `${file}#${c.step}`,
        form: c.form,
        marked: (raw[c.line - 1] ?? '').includes(VOID_OK),
      }));
    });

  it('finds the call sites at all', () => {
    // A rename or a moved import would empty this list and make every assertion below
    // vacuously true, which is the one way a convention test fails open.
    expect(sites.length, 'no markStep call site found — has it been renamed?').toBeGreaterThan(0);
  });

  it('no marker is fired and forgotten', () => {
    const loose = sites
      .filter((s) => s.form !== 'await' && !(s.form === 'void' && s.marked))
      .map((s) => {
        const why =
          s.form === 'void'
            ? '`void`, with no `' + VOID_OK + '` marker'
            : s.form
              ? 'consumed by `' + s.form + '`, which does not wait for it'
              : 'a bare call — nothing waits for it';
        return `${s.at} — ${why}`;
      });
    expect(
      loose,
      `markStep is not awaited at:\n  ${loose.join('\n  ')}\n` +
        `Await it — the write has to be ON DISK before the boundary it marks, or the marker is ` +
        `a no-op in exactly the crash it exists for. If the call site genuinely cannot await, ` +
        `end the line with \`// ${VOID_OK}\` and register it in VOID_MARKERS with the reason.`,
    ).toEqual([]);
  });

  it('the fire-and-forget markers are exactly the registered ones', () => {
    const marked = sites
      .filter((s) => s.form === 'void' && s.marked)
      .map((s) => s.key)
      .sort();
    const register = Object.entries(VOID_MARKERS)
      .map(([key, why]) => `  ${key} — ${why}`)
      .join('\n');
    expect(
      marked,
      `the \`${VOID_OK}\` call sites do not match VOID_MARKERS. A new one has to be argued for ` +
        `here, and a removed one has to be taken out here.\nRegistered exemptions:\n${register}`,
    ).toEqual(Object.keys(VOID_MARKERS).sort());
  });
});

// ---------------------------------------------------------------------------------------
// 14 — the signed-in locale is resolved in exactly one place (#331)
// ---------------------------------------------------------------------------------------

/**
 * Fifty-eight screens each wrote their own `profile?.locale ?? 'it'`, in four spellings, and
 * the tab bar wrote `?? deviceLocale` — so an English-device member read Italian everywhere
 * except the tabs. The ruling made the tab bar right: no stored locale follows the DEVICE.
 * That is now `useLocale()`, and this section is what stops the fifty-ninth copy.
 *
 * The failure this guards is silent. A resurrected `?? 'it'` type-checks, lints, renders, and
 * is only visible to a member whose device is not Italian — which is nobody on the dev
 * machine.
 *
 * `deviceLocale` stays legal in exactly two kinds of place. The ones with no profile to read:
 * the funnel and the boot screens that draw before (or instead of) a session, the draft store,
 * and the two hooks. And text the SYSTEM draws rather than an Athanor screen, which sits among
 * the phone's own labels in the device language: the Android notification channel (#746).
 * Anywhere else it means a signed-in screen went around the hook.
 */
describe('the signed-in locale is resolved in exactly one place (#331)', () => {
  const RESOLVER = 'hooks/use-locale.ts';

  /** No profile exists yet (or at all) on these — or the system draws the text — so they read the device directly. */
  const DEVICE_LOCALE_OK = [
    RESOLVER,
    'hooks/use-draft-locale.ts',
    'lib/locale.ts',
    'lib/onboarding-draft.ts',
    'app/(onboarding)/index.tsx',
    'components/boot/AppErrorScreen.tsx',
    'components/boot/BrandSplash.tsx',
    'components/boot/ForceUpdateScreen.tsx',
    'components/boot/MaintenanceScreen.tsx',
    'components/boot/ProfileErrorScreen.tsx',
    // The Android notification channel's name (#746) is drawn by the SYSTEM settings screen,
    // among the phone's own labels in the device language — not by an Athanor screen, and
    // registration runs outside React, where useLocale() cannot be called.
    'lib/push.ts',
  ];

  it('no screen hardcodes a locale fallback', () => {
    const hits = codeLines().filter(([, text]) => /locale\s*\?\?\s*['"](it|en)['"]/.test(text));
    expect(
      hits.map(([at, text]) => `${at} ${text.trim()}`),
      'a hardcoded locale fallback is back — use useLocale() (#331)',
    ).toEqual([]);
  });

  /**
   * Reading the column at all, not just reading it WITH a fallback. The `?? 'it'` spelling is
   * the one the issue counted, but two screens held a non-null `profile` and wrote a bare
   * `const locale = profile.locale;` — same resolution, no `??` to grep for, and the first
   * version of this guard sailed straight past both.
   */
  const PROFILE_LOCALE_OK = [
    RESOLVER,
    // The locale PICKER's initial value — editing the stored column, not resolving a display
    // locale from it. The one read that must NOT become useLocale().
    'components/profile/ProfileEditForm.tsx',
  ];

  it('no screen resolves a display locale off a profile itself', () => {
    const hits = codeLines()
      .filter(([at]) => !PROFILE_LOCALE_OK.some((ok) => at.includes(ok)))
      .filter(([, text]) => /\bprofile\??\.locale\b/.test(text));
    expect(
      hits.map(([at, text]) => `${at} ${text.trim()}`),
      `only ${RESOLVER} may read profile.locale for display — every screen calls useLocale()`,
    ).toEqual([]);
  });

  it('deviceLocale is read only where there is no profile to read', () => {
    const users = CODE_LINES.filter(([p]) => !isTest(p))
      .filter(([, ls]) => ls.some((t) => /\bdeviceLocale\b/.test(t)))
      .map(([p]) => rel(p).replace('apps/native/src/', ''))
      .sort();
    expect(
      users,
      'a signed-in surface reading deviceLocale directly has gone around useLocale() (#331)',
    ).toEqual([...DEVICE_LOCALE_OK].sort());
  });
});

// ---------------------------------------------------------------------------------------
// 15 — no text field renders its placeholder in the platform grey (#499)
// ---------------------------------------------------------------------------------------

/**
 * `placeholderTextColor` is the one color RN takes as a VALUE rather than a class, so a field
 * that omits it type-checks, lints, renders, and quietly draws its placeholder in the platform
 * default instead of `foregroundMuted`. Twelve did (#499); sixteen did before #333. Nothing else
 * in the toolchain can see it — NativeWind has no `placeholder:` variant on native, so there is
 * no class for a linter to miss either.
 *
 * The fix is a primitive (`Input` for the pill, `Field` for the block), and both omit
 * `placeholderTextColor` from their prop types so it cannot be handed back. This guard covers the
 * raw `<TextInput>`s that remain — the compose bars and the fund controls, which have their own
 * shapes and are not worth a third primitive.
 *
 * Cutting each element at its first `/>` is deliberately naive: no `<TextInput>` in this tree
 * takes children or a JSX-valued prop, and if that ever changes the cut lands EARLY, which loses
 * coverage rather than inventing a failure — the same trade `stripComments` makes.
 */
describe('placeholders are a token, never the platform default (#499)', () => {
  /** `[path:line, attribute text]` for every `<TextInput …/>` element in the tree. */
  const textInputs = (): [string, string][] =>
    CODE_LINES.flatMap(([p, ls]) => {
      const src = ls.join('\n');
      const out: [string, string][] = [];
      for (const m of src.matchAll(/<TextInput[\s>]/g)) {
        const start = m.index;
        const end = src.indexOf('/>', start);
        if (end === -1) continue;
        const line = src.slice(0, start).split('\n').length;
        out.push([`${rel(p)}:${line}`, src.slice(start, end)]);
      }
      return out;
    });

  it('every TextInput that shows a placeholder colors it', () => {
    const bare = textInputs()
      .filter(([, attrs]) => /\bplaceholder[=\s]/.test(attrs))
      .filter(([, attrs]) => !/\bplaceholderTextColor\b/.test(attrs));
    expect(
      bare.map(([at]) => at),
      'a placeholder is rendering in the platform grey — route it through Field/Input, or pass ' +
        'placeholderTextColor={galleria.foregroundMuted} (#499)',
    ).toEqual([]);
  });

  /**
   * The primitive is the reason the list above stays short, so the ways in are pinned by name.
   * A newly hand-rolled block field is the regression this catches: it would satisfy the
   * assertion above just by pasting the prop, which is exactly the drift #499 removed.
   *
   * The pin is on the block's RADIUS, because that is what a hand-rolled copy would paste. It
   * was `hero` (26) until 2026-10-04; under Galleria a multi-line field is radius 24 (DESIGN
   * §9), so the pin followed it, and the second assertion below keeps the old radius from
   * coming back on a text field.
   *
   * Matched on the ELEMENT's own attributes, not on the file — a file-level match would also
   * name every screen that merely wraps something in a container of the same radius.
   *
   * The list carries NO exceptions, and keeping it that way is the whole of #504. The three
   * compose screens — story, post, project — were the rest of this family and sat here in a
   * `HERO_NOT_YET_ROUTED` array, because #499 had defined its twelve as the fields MISSING
   * `placeholderTextColor` and these three already passed it. Marco's ruling (2026-08-30) folded
   * them in, so the assertion below now says what its own title always claimed.
   *
   * The exception array is gone rather than emptied: an empty list is an invitation to append to,
   * and the next hand-rolled field should have nowhere to be written down.
   */
  it('the block field exists in exactly one place', () => {
    const users = [
      ...new Set(
        textInputs()
          .filter(([, attrs]) => /(?<![\w-])rounded-\[24px\]/.test(attrs))
          .map(([at]) => at.replace('apps/native/src/', '').replace(/:\d+$/, '')),
      ),
    ].sort();
    expect(
      users,
      'a block text field has been hand-rolled again — use the Field primitive (#499)',
    ).toEqual(['components/Field.tsx']);
  });

  it('no text field keeps the hero radius the block had before Galleria', () => {
    expect(
      textInputs()
        .filter(([, attrs]) => /\brounded-hero\b/.test(attrs))
        .map(([at]) => at),
      'a `rounded-hero` text field: the block field is radius 24 since 2026-10-04 (DESIGN §9) ' +
        '— use the Field primitive (#499)',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 16 — the upload transport is a single seam (#450)
// ---------------------------------------------------------------------------------------

/**
 * #450 is FIXED, not deferred: the request body is file-backed on every platform. It used to be
 * `xhr.send({ uri })`, whose cost was platform-split — Android's `NetworkingModule` streamed it,
 * while iOS's `RCTNetworkTask.mm` appended the whole file into an `NSMutableData` that
 * `RCTNetworking.mm` assigned as `HTTPBody`, so a picked video was one contiguous native
 * allocation before the request left, and inside Expo Go that is an OS jetsam kill rather than a
 * catchable error.
 *
 * What made the fix affordable, and what keeps the next one affordable, is that there is exactly
 * ONE place bytes leave the device. Six buckets (`post-media`, `avatars`, `moments`,
 * `story-segments`, `candidacy-videos`, `chat-media`) and every upload surface funnel through
 * `uploadLocalFile` → `uploadFile` → this seam, so a transport change is one module and never a
 * sweep. That property was true by luck before #450 and is asserted here instead.
 *
 * The seam is split in two on purpose and both halves are pinned below:
 *
 * - `upload-task.ts` is the ONLY file that may name `expo-file-system` or `XMLHttpRequest`. A
 *   second construction site anywhere silently doubles the cost of the next transport change.
 * - `upload-transport.ts` holds the policy (watchdog, cancellation, the error taxonomy) and must
 *   import NO platform module at all. That is not tidiness: `environment: 'node'` is what
 *   collects this suite, `candidacy-video-status.ts` imports the error classes from it, and one
 *   `expo-*` import there takes both files out of the harness with no other symptom.
 *
 * Comments are stripped first — `upload-task.ts` names both types in prose, and #450's own
 * reasoning is the kind of thing a future docblock will quote. TEST files are excluded from the
 * two name pins for the same reason this file excludes itself: `upload-task.test.ts` mocks the
 * seam, and a mock has to name what it replaces.
 */
describe('the upload transport is a single seam (#450)', () => {
  const TASK = 'lib/media/upload-task.ts';
  const POLICY = 'lib/media/upload-transport.ts';

  const shippedFilesNaming = (pattern: RegExp): string[] =>
    [
      ...new Set(
        codeLines()
          .filter(([at, text]) => !isTest(at.replace(/:\d+$/, '')) && pattern.test(text))
          .map(([at]) => at.replace('apps/native/src/', '').replace(/:\d+$/, '')),
      ),
    ].sort();

  it('XMLHttpRequest is used in exactly one file, and it is the platform seam', () => {
    expect(
      shippedFilesNaming(/\bXMLHttpRequest\b/),
      'XMLHttpRequest has escaped the seam. It is the WEB arm of the upload transport only — on ' +
        `device the body must stay file-backed (#450). Route the upload through ${TASK}.`,
    ).toEqual([TASK]);
  });

  it('expo-file-system is imported in exactly one file, and it is the platform seam', () => {
    expect(
      shippedFilesNaming(/\bexpo-file-system\b/),
      'expo-file-system has escaped the seam. It is a no-op stub on web (it resolves ' +
        '`{ status: 0 }` and warns), so a second call site is a silently skipped upload on the ' +
        `one surface QA can reach. Route the upload through ${TASK}.`,
    ).toEqual([TASK]);
  });

  it('the policy module imports no platform module — a node-collectable unit', () => {
    // Whole-source, never line by line. Prettier wraps a named import list at printWidth 100, so
    // a per-line match would miss exactly the shape this repo produces — `[^'"]*?` spans the
    // newlines instead, and cannot run past the specifier because the first quote after the
    // keyword is always the specifier's. Two patterns because a side-effect `import 'x'` has no
    // `from` at all, and it is every bit as much a platform import as a named one.
    const src = stripComments(read(`${SRC}${POLICY}`));
    const bare = [
      ...src.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g),
      ...src.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g),
    ]
      .flatMap((m) => m[1] ?? [])
      .filter((specifier) => !specifier.startsWith('.'));
    expect(
      bare,
      `${POLICY} must import nothing outside its own directory. It is unit-tested under ` +
        "vitest's node environment, and `candidacy-video-status.ts` pulls its error classes in " +
        `— one expo import here silently drops both files out of the suite. Put it in ${TASK}.`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 17 — a picker that can refuse can always say why (#507, widened by #154)
// ---------------------------------------------------------------------------------------

/**
 * `MediaSheet`'s `onError` is the only way a refusal reaches the screen. Omit it on a sheet
 * that accepts video and an over-cap pick closes the sheet in silence — which is exactly the
 * bug #507 closed, in all four compose surfaces at once, for two months.
 *
 * Scoped to the sheets that can actually refuse something. An avatar sheet
 * (`(onboarding)/index.tsx`, `ProfileEditForm.tsx`) takes stills only, and `toPickedMedia` never
 * refuses a still. Those two may keep omitting `onError` — a picker that THREW is still worth
 * saying, but that is a separate, weaker claim than this one, and widening the guard to cover it
 * would be inventing a requirement no issue has asked for.
 *
 * `allowAudio` joins `allowVideo` as a trigger (#154) because the recorder refuses too, and on
 * one platform it refuses ALWAYS: a browser records a container no bucket accepts, so an
 * audio-capable sheet without `onError` is silent on every take taken in Expo web — which is
 * this repo's QA harness, and therefore the surface where that silence gets walked most.
 *
 * Cutting each element at its first `/>` is the same naive slice section 15 makes, for the same
 * reason: no `<MediaSheet>` in this tree takes children, and if one ever does the cut lands
 * EARLY, losing coverage rather than inventing a failure.
 */
describe('a video-capable picker can always say why it refused (#507)', () => {
  /** `[path:line, attribute text]` for every `<MediaSheet …/>` element in the tree. */
  const sheets = (): [string, string][] =>
    CODE_LINES.flatMap(([p, ls]) => {
      const src = ls.join('\n');
      const out: [string, string][] = [];
      for (const m of src.matchAll(/<MediaSheet[\s>]/g)) {
        const start = m.index;
        const end = src.indexOf('/>', start);
        if (end === -1) continue;
        const line = src.slice(0, start).split('\n').length;
        out.push([`${rel(p)}:${line}`, src.slice(start, end)]);
      }
      return out;
    });

  it('every MediaSheet that accepts video or audio wires onError', () => {
    expect(sheets().length, 'no MediaSheet found — has the component moved?').toBeGreaterThan(0);
    const mute = sheets()
      .filter(([, attrs]) => /\ballowVideo\b/.test(attrs) || /\ballowAudio\b/.test(attrs))
      .filter(([, attrs]) => !/\bonError\b/.test(attrs));
    expect(
      mute.map(([at]) => at),
      'a MediaSheet that can refuse has no onError — an over-cap video, or a recording in a ' +
        'container no bucket accepts, would close the sheet without a word (#507, #154). ' +
        'Pass onError={(key) => setError(t(key, locale))}.',
    ).toEqual([]);
  });

  it('finds at least one audio-capable sheet to be walking (#154)', () => {
    // Without this the widened filter is vacuous the day allowAudio is renamed: every sheet
    // would simply stop matching and the section would report a clean tree.
    expect(
      sheets().filter(([, attrs]) => /\ballowAudio\b/.test(attrs)).length,
      'no MediaSheet offers the recorder — has allowAudio been renamed or dropped?',
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------
// 18 — the events tab has no posts source (#153)
// ---------------------------------------------------------------------------------------

/**
 * The feed's sixth tab renders real `events` rows, and `'eventi'` is deliberately NOT a
 * `post_category` value (Reading A — widening the enum — was ruled out 2026-08-23, so no
 * migration is owed). `getFeedPage` builds `.eq('category', …)` against that enum, which means
 * a tab value reaching it is a PostgREST 400 at runtime on a screen that type-checks fine.
 *
 * `packages/api` declares its own `PostCategory | 'all'` on both entry points rather than
 * importing the app's alias, so merely widening `FeedFilter` would fail typecheck at the call
 * site — the compiler covers that half. What it does not cover is an `as FeedFilter` on the tab
 * state, or a screen that stops narrowing at all, which is what these assertions are for.
 */
describe('the events tab has no posts source (#153)', () => {
  /** Every line that reads the posts feed. */
  const reads = () =>
    codeLines().filter(([, text]) => /\b(?:postKeys\.feed|getFeedPage)\s*\(/.test(text));

  it('finds the posts-query call sites at all', () => {
    expect(reads().length, 'no posts read found — has the feed query moved?').toBeGreaterThan(0);
  });

  /**
   * An ALLOWLIST: the identifier feeding `postKeys.feed(…)` and `category:` must be the narrowed
   * one. A denylist on `tab` would go blind the moment that state is renamed, and scanning
   * line-by-line misses the real shape — the call spans four lines and `category:` sits on its
   * own.
   *
   * Two properties of the allowlist are deliberate. `NARROWED` is load-bearing: renaming the
   * screen's variable turns this red until the constant follows, which is the cost of not
   * having a denylist. And a string literal (`category: 'eventi'`) is skipped rather than
   * flagged — fail-open here, because `packages/api`'s own `PostCategory | 'all'` rejects that
   * one at compile time and this guard exists for what the compiler cannot see.
   */
  it('the posts query is fed only by the narrowed value', () => {
    const NARROWED = 'postsCategory';
    const args: [string, string][] = [];
    for (const [p, ls] of CODE_LINES) {
      const src = ls.join('\n');
      if (!/\b(?:postKeys\.feed|getFeedPage)\s*\(/.test(src)) continue;
      for (const m of src.matchAll(/(?:postKeys\.feed\(|\bcategory:)\s*([A-Za-z_$][\w$]*)/g)) {
        args.push([`${rel(p)}:${src.slice(0, m.index).split('\n').length}`, m[1] as string]);
      }
    }
    expect(
      args.length,
      'no posts-query argument found — has the call shape changed?',
    ).toBeGreaterThan(0);
    expect(
      args.filter(([, name]) => name !== NARROWED),
      'the posts query is reading something other than the narrowed category — the «Eventi» ' +
        "tab would send category='eventi' to an enum of four values (PostgREST 400). Feed it " +
        `${NARROWED} = postsFilter(tab).`,
    ).toEqual([]);
  });

  it('every file that reads posts narrows through postsFilter first', () => {
    const readers = [...new Set(reads().map(([at]) => at.replace(/:\d+$/, '')))].sort();
    const unnarrowed = readers.filter((r) => {
      const file = FILES.find((p) => rel(p) === r) as string;
      return !/\bpostsFilter\s*\(/.test(stripComments(read(file)));
    });
    expect(
      unnarrowed,
      'a screen reads the posts feed without going through postsFilter — that helper is the ' +
        'one door between the six-tab row and the five-category posts query (#153).',
    ).toEqual([]);
  });

  it('nothing casts a tab into a posts filter', () => {
    const casts = codeLines().filter(([, text]) => /\bas\s+FeedFilter\b/.test(text));
    expect(
      casts.map(([at]) => at),
      'a cast to FeedFilter defeats the only guard the compiler gives this: FeedTab has one ' +
        'member FeedFilter does not, and it has no posts source.',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 21 — no Pressable is mounted inside another Pressable (#518, #292)
// ---------------------------------------------------------------------------------------

/**
 * `Pressable` defaults `accessible={true}` (`react-native@0.86.3`, `Pressable.js:252`), and on
 * iOS an accessible view is ATOMIC: VoiceOver focuses it as one unit and never descends into
 * it. So a Pressable inside a Pressable is a control a screen-reader user cannot reach.
 *
 * #518 was exactly that, and it was total rather than cosmetic: `StoryRing`'s + badge sat
 * inside the ring's own Pressable, and for a member with a live story the ring tap opens the
 * viewer, so the badge was the ONLY way into the composer. A VoiceOver user could not add a
 * step at all.
 *
 * ## Why this keys on `Pressable` and not on `accessibilityRole`
 *
 * The obvious guard — "no `accessibilityRole="button"` inside another" — under-detects, and did
 * pass over two real instances. `PermissionPrimer.tsx` (`PermissionBlockedSheet.tsx` since #908,
 * 2026-10-01) nested a LABELLED «Non ora» button two
 * Pressables deep inside a scrim and a sheet that declare no role; both were still `accessible`,
 * so iOS swallowed the descendant anyway — and `MediaSheet.tsx` had the same pair. The mechanism
 * is `accessible`, which `Pressable` sets for you, and #292's note
 * (its Pressable in `components/media/MomentTile.tsx`) says so in as many words: "anything
 * `accessible` nested inside it". Keying on the role would have made this guard agree with the bug.
 *
 * Which is also why the walk reads `accessible={false}`: that attribute is what actually decides
 * whether an ancestor swallows, so it is what decides whether a nesting is a hit. The two media
 * modals are not hits any more because they carry it, not because they were forgiven.
 *
 * Nothing else catches this: `eslint-config-expo@10.0.0` ships no accessibility rules, no a11y
 * plugin is declared anywhere, and gate G2 (`docs/RELEASE-RUNBOOK.md`) is a manual smoke that
 * missed #518 outright.
 *
 * ## The register below is EMPTY, and that is the goal state
 *
 * It held `PermissionPrimer.tsx` (now `PermissionBlockedSheet.tsx`) and `MediaSheet.tsx` — real
 * instances deferred with an
 * argument, not excused. They are fixed now: `accessible={false}` on each scrim and sheet, plus
 * an «Annulla» row in `MediaSheet`, which had no close control of its own and would otherwise
 * have gained focusable rows and no way out.
 *
 * The register stays because the mechanism should outlive the two entries. An exemption belongs
 * here only with the argument for why the inner control is not the only way to do something —
 * and the third assertion below fails if a registered file stops nesting, so an entry cannot
 * outlive what it excused.
 */
const NESTED_PRESSABLE_OK: Record<string, string> = {};

/**
 * An ancestor only swallows what is under it while it is an accessibility ELEMENT. `Pressable`
 * makes one by default, and `accessible={false}` unmakes it — so a frame carrying that attribute
 * is not an atomic ancestor and must not produce a hit. Matched on the RAW attribute slice, not
 * on the blanked accumulator `jsxOpeningTags` builds: that one replaces brace contents with
 * spaces, which turns `accessible={false}` into `accessible=` and would never match here.
 *
 * The hatch cuts both ways, and the second edge is asserted below: `accessible={false}` on an
 * element that ALSO claims a role or a label is a control nobody can reach — silenced from the
 * tree while still announcing itself in source as interactive. That would trade the nesting
 * defect for a quieter one, so the walk collects those too ({@link nestedTags}' `muted`) and
 * the fourth assertion keeps the set empty.
 */
const NOT_ACCESSIBLE = /\baccessible=\{\s*false\s*\}/;
/** The other half of the contradiction: a role or label on the same element. */
const CLAIMS_CONTROL = /\baccessibility(Role|Label)=/;

/**
 * Component tags with an ancestor stack. A tag-depth walk rather than a regex: nesting is the
 * whole question here, and a regex cannot see an ancestor. Self-closing tags never push.
 * Attribute text is skipped quote- and brace-aware, so a render prop's nested JSX does not
 * close the tag that carries it.
 *
 * ## What it cannot see, stated rather than implied
 *
 * The walk is per-file and syntactic, so nesting through a COMPONENT is invisible to it: a
 * `<Row/>` that is itself a Pressable reads as a self-closing non-Pressable and never pushes a
 * frame, even though at runtime it is a descendant of whatever wraps it. `MediaSheet.tsx` WAS
 * exactly that case — its three `<Row/>` actions were invisible to the walk even while its
 * scrim/sheet pair was a hit. Both are fixed now (`accessible={false}` plus the «Annulla»
 * row), but the blindness itself remains. Following it would mean resolving local components
 * to their roots, which is a type-aware job this harness cannot do — `environment: 'node'`
 * cannot even render a `.tsx`.
 *
 * A SPREAD is opaque for the same reason. `{...MODAL_A11Y}` could in principle carry
 * `accessible`, and a syntactic scan cannot resolve the constant to find out. Harmless today —
 * `MODAL_A11Y` is only `{ accessibilityViewIsModal: true }` (`lib/a11y.ts`) — but if a spread
 * ever carries the flag, this walk will not see it and will report a hit that is not one. The
 * failure direction is at least the safe one: a false positive argues for itself in review,
 * where a false negative would sit silent.
 *
 * So a clean run means two things and no more: no nested Pressable is spelled out in one file
 * without an inline `accessible={false}` on the outer one, and no silenced Pressable claims a
 * role or label. Not "no Pressable is nested at runtime" — but it still catches #518, which
 * was spelled out.
 */
function nestedTags(
  src: string,
  tag: string,
): { hits: { line: number; outerLine: number }[]; muted: { line: number }[] } {
  const hits: { line: number; outerLine: number }[] = [];
  const muted: { line: number }[] = [];
  const stack: { name: string; line: number; attrs: string }[] = [];
  const lineAt = (i: number) => src.slice(0, i).split('\n').length;
  let i = 0;
  while (i < src.length) {
    if (src[i] !== '<') {
      i += 1;
      continue;
    }
    const close = /^<\/([A-Za-z_$][\w$.]*)\s*>/.exec(src.slice(i));
    if (close) {
      const name = (close[1] as string).split('.')[0] as string;
      // Pop to the nearest matching open. A mismatch means the walk lost sync on something
      // exotic; dropping the frame is the conservative move — it can only lose a hit.
      for (let k = stack.length - 1; k >= 0; k -= 1) {
        if (stack[k]?.name === name) {
          stack.length = k;
          break;
        }
      }
      i += close[0].length;
      continue;
    }
    const open = /^<([A-Za-z_$][\w$.]*)(?=[\s/>])/.exec(src.slice(i));
    // A `<` preceded by an identifier character is a GENERIC ARGUMENT, not a tag:
    // `useRef<View>(null)` matches the pattern above exactly, because `>` is in the lookahead
    // class. Left in, it pushes an ancestor frame that never balances, and the next real
    // `</View>` pops back to that phantom and takes the live frames above it with it — so the
    // walk loses hits rather than inventing them, which is the failure mode a guard cannot
    // afford. Inert for `Pressable` today only because nothing re-exports it as a type.
    if (!open || (i > 0 && /[A-Za-z0-9_$]/.test(src[i - 1] as string))) {
      i += 1;
      continue;
    }
    const name = (open[1] as string).split('.')[0] as string;
    const openLine = lineAt(i);
    let j = i + open[0].length;
    let depth = 0;
    let quote = '';
    let selfClosing = false;
    while (j < src.length) {
      const c = src[j] as string;
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) {
        selfClosing = src[j - 1] === '/';
        break;
      }
      j += 1;
    }
    const attrs = src.slice(i + open[0].length, j);
    if (name === tag) {
      // The contradiction case: silenced AND claiming to be a control. A per-tag property,
      // not a nesting one — the element is unreachable wherever it sits.
      if (NOT_ACCESSIBLE.test(attrs) && CLAIMS_CONTROL.test(attrs)) muted.push({ line: openLine });
      // The nearest ancestor of the same tag that is STILL an accessibility element. One that
      // declares `accessible={false}` is transparent to VoiceOver, so it is skipped rather than
      // reported — that is the whole mechanism by which the media modals stopped being hits.
      const outer = [...stack]
        .reverse()
        .find((f) => f.name === tag && !NOT_ACCESSIBLE.test(f.attrs));
      if (outer) hits.push({ line: openLine, outerLine: outer.line });
    }
    if (!selfClosing) stack.push({ name, line: openLine, attrs });
    i = j + 1;
  }
  return { hits, muted };
}

describe('no Pressable is mounted inside another Pressable (#518)', () => {
  const offenders = new Map<string, string[]>();
  const silencedControls: string[] = [];
  for (const p of FILES.filter((f) => !isTest(f) && f.endsWith('.tsx'))) {
    const { hits, muted } = nestedTags(stripComments(read(p)), 'Pressable');
    if (hits.length > 0) {
      offenders.set(
        rel(p),
        hits.map((h) => `:${h.line} inside the Pressable at :${h.outerLine}`),
      );
    }
    for (const m of muted) silencedControls.push(`${rel(p)}:${m.line}`);
  }

  it('the scanner finds the Pressables it is walking', () => {
    const seen = FILES.filter((f) => !isTest(f) && f.endsWith('.tsx')).filter((f) =>
      /<Pressable[\s/>]/.test(stripComments(read(f))),
    );
    expect(
      seen.length,
      'no <Pressable> found at all — has the tw wrapper been renamed?',
    ).toBeGreaterThan(10);
  });

  it('no unregistered nesting', () => {
    const loose = [...offenders]
      .filter(([file]) => !(file in NESTED_PRESSABLE_OK))
      .flatMap(([file, where]) => where.map((w) => `${file}${w}`));
    expect(
      loose,
      `a Pressable is nested inside another:\n  ${loose.join('\n  ')}\n` +
        `On iOS the inner one is unreachable to VoiceOver — Pressable is accessible by ` +
        `default, and an accessible view is atomic. Make the two SIBLINGS under a plain View ` +
        `(the components/feed/FeedPost.tsx shape), or register the file in ` +
        `NESTED_PRESSABLE_OK with the argument for why the inner control is not the only way ` +
        `to do something.`,
    ).toEqual([]);
  });

  it('a silenced Pressable carries no role or label', () => {
    expect(
      silencedControls,
      `accessible={false} together with accessibilityRole/accessibilityLabel at:\n  ` +
        `${silencedControls.join('\n  ')}\n` +
        `The flag removes the element from the accessibility tree, so a role or label on the ` +
        `same element is a control nobody can reach. Either it is decoration — drop the role ` +
        `and label — or it is a control: do not silence it, restructure the nesting as ` +
        `siblings instead (the components/feed/FeedPost.tsx shape).`,
    ).toEqual([]);
  });

  it('the registered exemptions are exactly the ones that still nest', () => {
    const register = Object.entries(NESTED_PRESSABLE_OK)
      .map(([file, why]) => `  ${file} — ${why}`)
      .join('\n');
    expect(
      [...offenders.keys()].filter((f) => f in NESTED_PRESSABLE_OK).sort(),
      `NESTED_PRESSABLE_OK does not match the tree. A file that stopped nesting has to be ` +
        `taken out, or the exemption outlives the thing it excused.\nRegistered:\n${register}`,
    ).toEqual(Object.keys(NESTED_PRESSABLE_OK).sort());
  });
});

// ---------------------------------------------------------------------------------------
// 22 — a VoiceOver-silenced sheet still exposes a way out (#551, #518)
// ---------------------------------------------------------------------------------------

/**
 * §21 guards one half of the modal recipe and the recipe has two.
 *
 * Silencing a scrim with `accessible={false}` is what lets VoiceOver descend into the sheet,
 * and it is also what REMOVES tap-outside-to-close from the accessibility tree: the scrim was
 * the exit, and the fix that reaches the rows is the same edit that deletes the way out.
 * `MediaSheet.tsx` was exactly that — it had no close control of its own, so the #518 fix had
 * to add an «Annulla» row in the same commit or it would have traded an unreachable sheet for
 * an inescapable one (PR #547, commits 10–11).
 *
 * `onAccessibilityEscape` cannot stand in for the control, and the reason is not stylistic:
 * React Native fires the escape gesture only "when accessible is true"
 * (`onAccessibilityEscape` in react-native's `ViewAccessibility.d.ts`), which is precisely the flag
 * being turned off. So the exit has to be a real element, and nothing checked that one existed.
 *
 * ## What counts as an exit
 *
 * The close callback is whatever a silenced `Pressable` passes as `onPress` — `onClose` in
 * `MediaSheet`, `onDismiss` in `PermissionBlockedSheet`. An exit is any element that is NOT itself
 * silenced and fires that same callback. Keyed on the callback rather than on
 * `accessibilityRole="button"` because the two live sheets spell their exit differently and
 * both are correct: `PermissionBlockedSheet` uses a bare `Pressable` with the role on it, while
 * `MediaSheet` passes `<Row onPress={onClose} />` and the role lives inside `Row`. A guard
 * keyed on the role would demand the call site carry an attribute one of them legitimately
 * does not — and §21's fourth assertion already owns the role-on-a-silenced-element question.
 *
 * Being INSIDE a silenced ancestor is not disqualifying, and that is the point of the whole
 * recipe: silencing the ancestor is what makes the descendant reachable. Only the element
 * itself must not carry the flag.
 *
 * ## Why the exit may not be gated on a busy flag
 *
 * `MediaSheet.tsx`'s cancel `Row` argues this in place, and nothing enforced it: the cancel row is
 * deliberately `disabled={false}` while the three source rows are `disabled={busy}`, because
 * an exit that goes dead during an in-flight pick restores the dead end for exactly as long
 * as the sheet is working — which is when a user is most likely to want out. A guard that
 * only asked "does an exit exist" would pass `disabled={busy}` on the cancel row.
 *
 * ## What this cannot see, stated rather than implied
 *
 * A close handler written inline (`onPress={() => setPending(null)}`) names no identifier, so
 * this walk reads no callback from it and the file drops out of the scan entirely rather than
 * failing. That is the vacuity risk, and the first assertion is a partial answer: the pair
 * count has a FLOOR, so a scrim on one of today's two sheets rewritten to an inline arrow makes
 * the scan go red instead of quietly going empty. Partial, and worth being exact about — a
 * THIRD sheet that arrives already spelled with an inline arrow never enters the scan and
 * leaves the floor green. The floor catches a regression from where the tree is now, not every
 * future one. It cannot be fixed by demanding named handlers — that would be this guard
 * legislating an unrelated style rule — but it can be made loud, and it is.
 *
 * The exit is recognised through `onPress` and no other prop. A close control wired as
 * `<SheetHeader onClose={onClose} />` or a `Button` taking `onDismiss` reads as no exit at all
 * and fails the second assertion on correct code. Widen `ON_PRESS_IDENT` when that shape
 * arrives — the call site is not the thing to change.
 *
 * Per-callback rather than per-file, deliberately. If a file names two close callbacks and
 * only one has an exit, the file fails. That over-reports on a shape nobody writes today (two
 * independent sheets in one file), and §21's own note says which direction a guard must err
 * in: a false positive argues for itself in review, a false negative sits silent.
 */
/** `onPress={handler}` — a bare identifier only; an inline arrow deliberately yields nothing. */
const ON_PRESS_IDENT = /\bonPress=\{\s*([A-Za-z_$][\w$]*)\s*\}/;

/**
 * `disabled={busy}` gates the exit; `disabled={false}` does not, and neither does no prop.
 *
 * Matched as a PROP, not as a word: `\bdisabled\b` also fires on `className="disabled:opacity-50"`
 * and on a `${disabled ? … }` interpolation inside one, neither of which gates anything. The
 * lookahead requires the next character to be one a JSX attribute can be followed by.
 */
function gatedOnAFlag(raw: string): boolean {
  return /(?:^|\s)disabled(?=[=\s/>])/.test(raw) && !/\bdisabled=\{\s*false\s*\}/.test(raw);
}

describe('a VoiceOver-silenced sheet still exposes a way out (#551)', () => {
  /** One row per (file, close callback) the scan resolved, with the exits it found for it. */
  const sheets: { at: string; callback: string; exits: string[]; live: string[] }[] = [];

  for (const p of FILES.filter((f) => !isTest(f) && f.endsWith('.tsx'))) {
    const tags = jsxOpeningTags(stripComments(read(p)));
    const silenced = tags.filter((t) => t.base === 'Pressable' && NOT_ACCESSIBLE.test(t.raw));
    for (const frame of silenced) {
      const callback = ON_PRESS_IDENT.exec(frame.raw)?.[1];
      if (!callback) continue; // a no-op stop-propagation sheet, or an inline handler
      const exits = tags.filter(
        (t) => !NOT_ACCESSIBLE.test(t.raw) && ON_PRESS_IDENT.exec(t.raw)?.[1] === callback,
      );
      sheets.push({
        at: `${rel(p)}:${frame.line}`,
        callback,
        exits: exits.map((t) => `${rel(p)}:${t.line} <${t.base}>`),
        live: exits.filter((t) => !gatedOnAFlag(t.raw)).map((t) => `${rel(p)}:${t.line}`),
      });
    }
  }

  it('finds the silenced sheets it is walking', () => {
    // Without this the section is vacuous by default: a walk that resolved no callback at all
    // would report no offenders and read exactly like a clean tree. Two today —
    // components/media/MediaSheet.tsx and components/media/PermissionBlockedSheet.tsx.
    // A FLOOR, not the count. An exact 2 would go red the day a third silenced sheet lands —
    // correct work tripping the guard, which is how a guard gets weakened instead of obeyed.
    expect(
      sheets.map((s) => `${s.at} → ${s.callback}`).length,
      'fewer silenced sheets resolve a close callback than the two this tree has. Either ' +
        'accessible={false} has left one of them, or a scrim now passes an inline arrow this ' +
        'walk cannot read — in which case give the handler a name, so the exit stays checkable.',
    ).toBeGreaterThanOrEqual(2);
  });

  it('every silenced sheet has something that fires its close callback', () => {
    const trapped = sheets.filter((s) => s.exits.length === 0);
    expect(
      trapped.map((s) => `${s.at} silences the scrim and nothing else calls ${s.callback}()`),
      `a sheet a screen-reader user cannot leave. accessible={false} takes the scrim out of ` +
        `the accessibility tree, so tap-outside-to-close stops existing for VoiceOver and the ` +
        `sheet needs a real control — an «Annulla» row (the components/media/MediaSheet.tsx ` +
        `shape) or an accessible dismiss (components/media/PermissionBlockedSheet.tsx). ` +
        `onAccessibilityEscape does not count: RN fires it only while accessible is true.`,
    ).toEqual([]);
  });

  it('the way out is never gated on a busy flag', () => {
    const gated = sheets.filter((s) => s.exits.length > 0 && s.live.length === 0);
    expect(
      gated.map(
        (s) => `${s.at} → every exit for ${s.callback}() is disabled: ${s.exits.join(', ')}`,
      ),
      `the only way out of this sheet goes dead while it is busy, which is when someone is ` +
        `most likely to want it. components/media/MediaSheet.tsx:222-227 makes the argument ` +
        `and spells the cancel row disabled={false} on purpose, next to three source rows ` +
        `that are disabled={busy}.`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 23 — a (modal) screen always has a way out (#578, #577)
// ---------------------------------------------------------------------------------------

/**
 * §22 asks whether a sheet exposes a control. This asks whether the control does anything.
 *
 * `router.back()` is a no-op when the screen is the root of its stack: no throw, no warning,
 * no navigation — the affordance is drawn, it is reachable, VoiceOver announces it, and
 * pressing it does nothing at all. There is no way to see that in a screenshot or a walk that
 * reached the screen by pushing, which is why it survived across 20 files.
 *
 * A `(modal)` screen is a stack root more often than the in-app push path suggests:
 * `AuthGuard` only ever `replace`s (`src/app/_layout.tsx`); `[handle].tsx`
 * `replace`s EVERY `/@handle` link into `/(modal)/user/[id]`; the Android `intentFilters` in
 * `app.json` claim `/post`, `/event` and `/dream`, none of which has a top-level route
 * directory, so they resolve into `(modal)` too; and a modal→modal `replace` hands its
 * root-ness to the screen it replaced.
 *
 * So the pop goes through `useGuardedBack` (`src/lib/modal-exit.ts`) and nowhere else. That
 * module is the only place `router.back()` may appear, and it is outside both scanned
 * directories by construction rather than by an allowlist entry that could be widened.
 *
 * ## Scope, and why `src/components` is in it
 *
 * `(modal)` screens and shared components both. A component does not know which screen mounts
 * it, so a `back()` inside `ModalHeader` is exactly as dead as one written in the screen —
 * that is where #577's bug lived. `(tabs)` and `(auth)` are out: a tab root has no back
 * affordance at all, and `(auth)/welcome.tsx` already renders its own on `router.canGoBack()`.
 *
 * ## What it cannot see
 *
 * The scan reads `router.back()` / `goBack()` / `dismiss()` spelled as member calls, plus the
 * one obvious rename (destructuring the popping methods off `useRouter()` — matched against the
 * whole file rather than per line, because prettier wraps a long destructuring across lines and
 * a line-scoped test would let exactly the wrapped form through). A router smuggled
 * through a helper of another name, or `navigationRef.current?.goBack()`, reads as clean. The
 * floor below is the partial answer §22 uses: it fails when the scan stops finding the screens
 * it is meant to be walking, so this cannot go quietly vacuous — but it does not make the
 * pattern list exhaustive, and a new spelling has to be added here when it arrives.
 */
const MODAL_SCREENS = FILES.filter((p) => !isTest(p) && p.includes('/app/(modal)/'));
const SHARED_COMPONENTS = FILES.filter((p) => !isTest(p) && p.includes('/components/'));
const EXIT_SCOPE = [...MODAL_SCREENS, ...SHARED_COMPONENTS];

/** `router.back()`, `router.dismiss()`, `router.dismissAll()`, `navigation.goBack()`. */
const BARE_POP = /\brouter\.(?:back|dismiss|dismissAll)\s*\(|\bgoBack\s*\(/;
/**
 * `const { back } = useRouter()` — the rename that would walk straight past `BARE_POP`. Global,
 * and run against the whole file rather than per line, because prettier wraps a destructuring
 * that outgrows the print width and the wrapped form is the one a line-scoped test misses.
 *
 * The gap is `[^{}]`, not `[\s\S]` — newline-tolerant either way, but a gap that may cross a
 * brace matches far more than a destructuring. `stripComments` preserves string literals on
 * purpose, `\bback\b` hits inside `'common.back'`, and nearly every screen in `EXIT_SCOPE`
 * carries that key: an unbounded gap starts at some earlier `{` (an import brace suffices),
 * crosses the key, and closes on an unrelated `}` before `= useRouter(`. That turns
 * `const { push } = useRouter()` — a perfectly legal line that pops nothing — red, with a
 * message accusing it of destructuring a popping method. Refusing to cross a brace keeps the
 * wrapped offender in range and puts that whole class out of it.
 */
const POP_OFF_ROUTER = /\{[^{}]*\b(?:back|dismiss|dismissAll)\b[^{}]*\}\s*=\s*useRouter\s*\(/g;

describe('a (modal) screen always has a way out (#578)', () => {
  it('finds the screens it is walking', () => {
    // A FLOOR, not the count — 52 `(modal)` files today. Without this the two assertions
    // below read identically on a clean tree and on a walk that resolved no files at all
    // (a renamed group, a changed `FILES` filter).
    expect(
      MODAL_SCREENS.length,
      'the (modal) group no longer resolves — has the route group been renamed? This section ' +
        'is vacuous until the path filter matches again.',
    ).toBeGreaterThanOrEqual(40);
  });

  it('no (modal) screen or shared component pops the stack directly', () => {
    const offenders = EXIT_SCOPE.flatMap((p) => {
      const code = stripComments(read(p));
      const perLine = code
        .split('\n')
        .flatMap((text, i) => (BARE_POP.test(text) ? [`${rel(p)}:${i + 1} ${text.trim()}`] : []));
      // Whole-file, so a prettier-wrapped destructuring cannot slip between two lines.
      const destructured = [...code.matchAll(POP_OFF_ROUTER)].map(
        (m) =>
          `${rel(p)}:${code.slice(0, m.index).split('\n').length} destructured off useRouter()`,
      );
      return [...perLine, ...destructured];
    });
    expect(
      offenders,
      'a pop that is a silent no-op whenever this screen is the stack root — the member is ' +
        'left on a screen whose only exit is force-quitting the app. Use `useGuardedBack()` ' +
        'from src/lib/modal-exit.ts, which falls back to a real destination; pass a parent ' +
        'route when home is not the right one.',
    ).toEqual([]);
  });

  it('the guarded exit still branches, and the chevron never hides itself again', () => {
    const helper = stripComments(read(`${SRC}lib/modal-exit.ts`));
    expect(
      [/\bcanGoBack\s*\(/.test(helper), /\brouter\.dismissTo\s*\(/.test(helper)],
      'src/lib/modal-exit.ts no longer branches on canGoBack, or no longer falls back with ' +
        'dismissTo. Flattening it to one call makes every assertion above vacuous: the whole ' +
        'tree would route its exits through a helper that dead-ends exactly like a bare back().',
    ).toEqual([true, true]);

    const header = stripComments(read(`${SRC}components/ModalHeader.tsx`));
    const showLeading = /const showLeading\s*=([^;]*);/.exec(header)?.[1] ?? '';
    expect(
      showLeading.includes('canGoBack'),
      'ModalHeader gates its leading affordance on canGoBack again (#578). That is the ' +
        'original defect, not a fix for it: on a stack root it renders NO way out at all, ' +
        'which is worse than a dead chevron, because the screen then offers nothing to press.',
    ).toBe(false);
  });

  it('every leading affordance carries a backLabel', () => {
    const unlabelled = FILES.filter((p) => !isTest(p) && p.endsWith('.tsx')).flatMap((p) =>
      jsxOpeningTags(stripComments(read(p)))
        .filter(
          (t) =>
            t.base === 'ModalHeader' &&
            !/leading=\{?['"]none['"]\}?/.test(t.raw) &&
            !/\bbackLabel\b/.test(t.raw),
        )
        .map((t) => `${rel(p)}:${t.line}`),
    );
    expect(
      unlabelled,
      'a ModalHeader that renders a back or a close with no accessibilityLabel. Since #578 the ' +
        'affordance renders unconditionally on every `leading` other than "none", so a missing ' +
        'backLabel is now an unlabelled button on every load rather than on a lucky one — ' +
        'VoiceOver announces it as just «button». `common.back` exists in both catalogs.',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 24 — a publish that buzzes also says so (#579)
// ---------------------------------------------------------------------------------------

/**
 * A haptic is not feedback. `expo-haptics` is a no-op on web — the whole react-native-web
 * surface this repo QAs on, and the only surface a tester without a device ever sees — and on
 * a phone a single Light impact is one buzz among the several a publish already makes as the
 * keyboard dismisses and the modal slides away. Every one of the three composers shipped with
 * that as its ENTIRE success feedback: the screen closed, and whether the post existed was
 * something the member had to go and check.
 *
 * So a success buzz owes a sentence, and #117 built the surface for it — `useToast()`, one
 * global host, which also outlives the composer's own exit and so reaches a member whose
 * publish settled after they left.
 *
 * ## What counts
 *
 * `impactAsync` and `notificationAsync` — the two that punctuate an OUTCOME, which is why the
 * scan is not named for success alone: a `notificationAsync` marking a FAILURE owes a sentence
 * for exactly the same reason, and lands in the same assertion. `selectionAsync` is the tick a
 * picker makes as it moves through its options; it is out of scope by meaning rather than by
 * exemption, and nothing calls it today.
 *
 * ## What it cannot see
 *
 * File-level, exactly like §11: it asserts that a screen which buzzes also announces, not that
 * the two sit in the same handler. Two consequences, both real rather than theoretical —
 * a screen with two outcome paths could toast one and buzz the other and read as clean, and a
 * screen that buzzes on success while toasting only its ERROR satisfies this as written. That
 * second one is a gap in what this can see, NOT a description of the tree it was written
 * against: the three composers carried no `showToast` at all before #579 and announced their
 * failures inline through `setError`, so this section flags all three of them on `dev` — which
 * is what the injection proof rests on. Pinning the pairing means parsing the handler an await
 * at a time; the register below is the honest escape and the floor is what keeps the section
 * from going quietly vacuous instead.
 */
const HAPTIC_WITHOUT_TOAST: Record<string, string> = {
  // A buzz that punctuates something other than an outcome belongs here, with the reason.
};

/** `Haptics.impactAsync(` / `Haptics.notificationAsync(` — the two that mark an outcome. */
const OUTCOME_HAPTIC = /\bHaptics\.(?:impactAsync|notificationAsync)\s*\(/;

describe('a success haptic is never the whole feedback (#579)', () => {
  it('finds the screens it is walking', () => {
    // A FLOOR, not a count — the three composers today. Without it, an `expo-haptics` drop or
    // a renamed import leaves both assertions reading identically on a clean tree and on a
    // scan that matched nothing at all. Dropping a composer's haptic is a decision, and this
    // is where it gets made rather than where it goes unnoticed.
    const sites = FILES.filter((p) => !isTest(p)).filter((p) =>
      OUTCOME_HAPTIC.test(stripComments(read(p))),
    );
    expect(
      sites.length,
      'no outcome haptic resolves any more — has expo-haptics been dropped, or the import ' +
        'renamed? This section is vacuous until the scan matches again.',
    ).toBeGreaterThanOrEqual(3);
  });

  it('every screen that buzzes on success also announces', () => {
    const silent = FILES.filter((p) => !isTest(p))
      .filter((p) => {
        const code = stripComments(read(p));
        return OUTCOME_HAPTIC.test(code) && !code.includes('showToast(');
      })
      .map((p) => rel(p).replace('apps/native/src/', ''))
      .filter((p) => !(p in HAPTIC_WITHOUT_TOAST))
      .sort();
    const register = Object.entries(HAPTIC_WITHOUT_TOAST)
      .map(([file, why]) => `  ${file} — ${why}`)
      .join('\n');
    expect(
      silent,
      `a success haptic with nothing said beside it:\n  ${silent.join('\n  ')}\n` +
        `The buzz is silent on web and easily missed on a device, so on its own it leaves the ` +
        `member to go and check whether their post exists. Announce with ` +
        `useToast().showToast(t('…'), 'success'), or register the file above with the reason ` +
        `its buzz marks something other than an outcome.\nRegistered exemptions:\n${register}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 25 — a post and its media are ONE write (#588)
// ---------------------------------------------------------------------------------------

/**
 * `publishPost` calls the `publish_post` RPC, so a post row and its media set land in one
 * transaction or not at all. What that replaced was two requests — `createPost` and then
 * `replacePostMedia` — with the post COMMITTED between them: a media write that failed for any
 * reason left a post whose `type` claimed media with nothing behind it, which the feed renders
 * as a silently text-only card. Three ways of undoing it, and each one restores a defect that
 * has already shipped once.
 *
 * **Splitting the write again.** The two-call shape is the defect. Both API functions are gone
 * rather than kept beside the RPC, so re-adding either to `@athanor/api` and calling it here
 * compiles cleanly and publishes the orphan card again — which is why this section names them
 * even though nothing exports them today.
 *
 * **Guarding it on a count.** The call site carried `if (rows.length > 0)` right up to #586,
 * and it reads as obviously free — why sweep a post that has no media? Because an EMPTY set is
 * not "nothing to do", it is the member having removed every attachment between a lost response
 * and the re-tap, and it is the only input for which the sweep is the entire point. Restored,
 * the first attempt's rows outlive a post whose `type` no longer claims them, and the feed
 * renders photos the member deleted.
 *
 * **Swallowing its failure.** What the call site did before was `.catch()` a 23505 from the
 * insert-only write, reading the conflict as the database confirming the first attempt landed.
 * There is no conflict left to swallow — the RPC converges instead — so a `.catch` here now
 * could only discard a real fault, and would toast success over a post that may not exist.
 *
 * ## What it cannot see
 *
 * Textual, and deliberately narrow: it matches an `if (….length…)` immediately in front of the
 * call and a `.catch` immediately behind it, which is the shape both regressions actually take
 * (one is a revert). A `try`/`catch` around the whole publish, a guard split across a helper, or
 * a condition with a call in it all read as clean here. It also scans `apps/native/src` only, so
 * a second write path added inside `@athanor/api` and never called from a screen is invisible —
 * `supabase/tests/0138_publish_post.test.sql` is what holds the database end. The floor below is
 * what keeps the section from going quietly vacuous when the function is renamed instead.
 */
const ATOMIC_PUBLISH = /\bpublishPost\s*\(/;
/** `if (rows.length > 0) [{] await publishPost(` — the guard #586 removed. */
const COUNT_GUARDED_PUBLISH =
  /\bif\s*\([^()]*\.length[^()]*\)\s*\{?\s*(?:await\s+)?publishPost\s*\(/;
/** `await publishPost(…).catch(` — the swallow #586 removed. */
const SWALLOWED_PUBLISH = /\bpublishPost\s*\([^;]*\)\s*\.catch\b/;
/** The two-call shape #588 replaced, by name. */
const SPLIT_POST_WRITE = /\b(createPost|replacePostMedia)\s*\(/;

describe('a post and its media are one write (#588)', () => {
  it('finds the composer it is walking', () => {
    // A FLOOR, not a count — one composer publishes a post today. Without it, a rename of the
    // API function leaves every assertion below reading identically on a clean tree and on a
    // scan that matched nothing at all.
    const sites = FILES.filter((p) => !isTest(p)).filter((p) =>
      ATOMIC_PUBLISH.test(stripComments(read(p))),
    );
    expect(
      sites.length,
      'nothing publishes a post any more — has publishPost been renamed? This section is ' +
        'vacuous until the scan matches again.',
    ).toBeGreaterThanOrEqual(1);
  });

  it('no call site writes the post and its media separately', () => {
    const split = FILES.filter((p) => !isTest(p))
      .filter((p) => SPLIT_POST_WRITE.test(stripComments(read(p))))
      .map((p) => rel(p).replace('apps/native/src/', ''))
      .sort();
    expect(
      split,
      `a post write split back into two requests:\n  ${split.join('\n  ')}\n` +
        `createPost and replacePostMedia committed the post BEFORE its media, so a failing ` +
        `media write published a card whose type claimed photos that were never there (#588). ` +
        `PostgREST has no client-side transaction — publish the whole thing through ` +
        `publishPost, which calls the publish_post RPC.`,
    ).toEqual([]);
  });

  it('no call site guards the publish on how much media there is', () => {
    const guarded = FILES.filter((p) => !isTest(p))
      .filter((p) => COUNT_GUARDED_PUBLISH.test(stripComments(read(p))))
      .map((p) => rel(p).replace('apps/native/src/', ''))
      .sort();
    expect(
      guarded,
      `a publish behind an attachment count:\n  ${guarded.join('\n  ')}\n` +
        `An empty set is the case the sweep exists for — the member removed every ` +
        `attachment — so skipping the call leaves the previous attempt's rows on a post ` +
        `that no longer claims them. Call publishPost unconditionally, with the set whole.`,
    ).toEqual([]);
  });

  it('no call site swallows the failure of the publish', () => {
    const swallowed = FILES.filter((p) => !isTest(p))
      .filter((p) => SWALLOWED_PUBLISH.test(stripComments(read(p))))
      .map((p) => rel(p).replace('apps/native/src/', ''))
      .sort();
    expect(
      swallowed,
      `a publish whose failure is discarded:\n  ${swallowed.join('\n  ')}\n` +
        `The 23505 this used to swallow cannot happen any more — the RPC converges — so a ` +
        `catch here can only hide a real fault and toast success over a post that may not ` +
        `exist. Let it throw; onError already says which half of the publish failed.`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 26 — every colour class names a token that exists (#595)
// ---------------------------------------------------------------------------------------

/**
 * A `text-`/`bg-`/`border-` class whose token is not declared in `global.css` produces no
 * declaration at all. react-native-css has nothing to emit, so the property is simply absent
 * and RN falls back to its own default — black text, no border colour — on a black
 * canvas. Nothing throws, nothing warns, and TypeScript cannot see inside a string literal.
 * #595 was `text-ink` on `RuleRow`: the Aura screen's three protection-rule headings rendered
 * at 1.07:1 against the background, invisible, for as long as the screen has existed.
 *
 * Nothing else in the tree looks at this. `contrast.test.ts` reads token VALUES out of
 * `@athanor/config` and never a `className` — it says so itself ("NOT a usage audit"), and a
 * class that resolves to nothing has no value to check. `tokens-mirror.test.ts` proves the CSS
 * and the TS agree on the tokens that DO exist, which is silent about who names one that does
 * not. §5 above catches a literal hex, not a class naming a colour that was never adopted.
 *
 * Both names this caught are residue of the prototype palette transcribed in `docs/DESIGN.md`
 * (§"Palette lineage": `cosmo · ink · ink2 · muted · faint · raise · raise2 · hair · auraSoft ·
 * auraLine · glow · onAura · danger`). Only part of that set landed in `@athanor/config`;
 * `ink` and `danger` did not, and their shipped equivalents are `foreground` and `error`. The
 * third was `border-border` in `(modal)/fund-disclosure.tsx`, an `apps/web` idiom carried
 * across — `apps/web/app/globals.css` really does declare `--color-border`, and native calls
 * the same token `line` while the card hairline everywhere else is `hair`.
 *
 * The scan is over comment-stripped CODE LINES, not over JSX attributes, and that is load
 * bearing: `LedgerRow` held `'text-danger'` in a `tone` variable, outside any opening tag, so
 * §6's `jsxOpeningTags` walk would never have seen it.
 *
 * ## What it cannot see
 *
 * An interpolated class (`` `text-${tone}` ``) and an arbitrary value (`text-[14px]`,
 * `text-[#fff]`) are both skipped by the leading `[A-Za-z0-9]` — the first has no token to
 * check, and a hex inside the second is §5's job. A default Tailwind palette colour
 * (`text-red-500`) IS reported, deliberately: it would resolve, but rule 4 says colours come
 * from the token set. The allowlist below is the non-colour utilities that share these three
 * prefixes; a new one has to be added there, which is the guard asking for a look rather than
 * a defect. One entry is pre-emptive and slightly too wide: `shadow-` masks Tailwind v4's
 * `text-shadow-<color>`, which does take a colour. Nothing in the tree uses it today, and
 * narrowing it is the fix if anything ever does.
 *
 * It reports in the other direction too. Scanning code lines rather than `className`
 * attributes is what catches a class held in a variable, and the cost is that ANY string
 * containing `text-`/`bg-`/`border-` — an i18n key, a storage path, a URL — would be reported
 * as a violation. None exists today; the remedy if one lands is to name the false positive
 * rather than to narrow the walk, because the walk is what found `LedgerRow`.
 */
const GLOBAL_CSS = readFileSync(`${SRC}global.css`, 'utf8');

/** Every `--color-*` custom property `global.css` declares, without the prefix. */
const DECLARED_COLORS = new Set(
  [...GLOBAL_CSS.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1] as string),
);

/** Non-colour utilities sharing these prefixes, plus the CSS-wide colour keywords. */
const NON_COLOR_CLASS = new Set([
  // text-* font sizes
  'xs',
  'sm',
  'base',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
  '6xl',
  '7xl',
  '8xl',
  '9xl',
  // text-* alignment, wrapping, overflow
  'left',
  'center',
  'right',
  'justify',
  'start',
  'end',
  'wrap',
  'nowrap',
  'balance',
  'pretty',
  'ellipsis',
  'clip',
  // bg-* attachment, repeat, size and position keywords
  'fixed',
  'local',
  'scroll',
  'none',
  'repeat',
  'no-repeat',
  'repeat-x',
  'repeat-y',
  'repeat-round',
  'repeat-space',
  'auto',
  'cover',
  'contain',
  'top',
  'bottom',
  'radial',
  'conic',
  // border-* styles and table behaviour
  'solid',
  'dashed',
  'dotted',
  'double',
  'hidden',
  'collapse',
  'separate',
  // CSS-wide colour keywords — real colours, no token behind them
  'transparent',
  'current',
  'inherit',
]);

/** The same, where the tail varies: border widths and sides, and the compound families. */
const NON_COLOR_CLASS_RE = [
  /^\d+$/, // border-2
  /^[xytrbles]$/, // border-t
  /^[xytrbles]-\d+$/, // border-l-2
  /^(clip|origin|blend|linear|radial|conic|gradient|position|size|image)-/, // bg-clip-border
  /^spacing-/, // border-spacing-2
  /^shadow(-|$)/, // text-shadow-sm
  /^(top|bottom|left|right|center)-/, // bg-left-top
];

/**
 * `text-…`, `bg-…`, `border-…` with an optional `/NN` opacity modifier. The leading
 * `[A-Za-z0-9]` is what skips arbitrary values and interpolations; the lookbehind keeps
 * `border-` from matching inside `bg-gradient-to-r`-style compounds already consumed.
 */
const COLOR_CLASS = /(?<![\w-])(?:text|bg|border)-([A-Za-z0-9][A-Za-z0-9._-]*(?:\/\d+)?)/g;

/**
 * Every colour-position class in app code, located. Off `CODE_LINES`, which is already the
 * whole tree comment-stripped and split — re-reading it here would double this file's
 * collection cost for nothing.
 */
const COLOR_CLASS_HITS = CODE_LINES.filter(([p]) => !isTest(p)).flatMap(([p, ls]) =>
  ls.flatMap((t, i) =>
    [...t.matchAll(COLOR_CLASS)].map((m) => ({
      where: `${rel(p)}:${i + 1}`,
      cls: m[0],
      token: (m[1] as string).replace(/\/\d+$/, ''),
      text: t.trim(),
    })),
  ),
);

describe('every colour class names a token that exists (#595)', () => {
  it('reads a token set out of global.css', () => {
    // A FLOOR, not a count. If the `--color-*` scan ever matches nothing — the stylesheet
    // moved, the custom properties were renamed — the assertion below would pass on a tree
    // where every single class resolves to nothing.
    expect(
      DECLARED_COLORS.size,
      'no --color-* tokens found in global.css — has the stylesheet moved? This section is ' +
        'vacuous until the scan matches again.',
    ).toBeGreaterThanOrEqual(15);
  });

  it('finds the colour classes it is walking', () => {
    // The other half of the same floor: a broken class regex reports zero violations exactly
    // like a clean tree does.
    expect(
      COLOR_CLASS_HITS.length,
      'no text-/bg-/border- classes found in apps/native/src — has the styling idiom changed? ' +
        'This section is vacuous until the scan matches again.',
    ).toBeGreaterThanOrEqual(500);
  });

  it('no text-, bg- or border- class names a token global.css does not declare', () => {
    const hits = COLOR_CLASS_HITS.filter(
      ({ token }) =>
        !NON_COLOR_CLASS.has(token) &&
        !NON_COLOR_CLASS_RE.some((re) => re.test(token)) &&
        !DECLARED_COLORS.has(token),
    ).map(({ where, cls, text }) => `${where}  ${cls}  ${text.slice(0, 100)}`);
    expect(
      hits,
      `a colour class that resolves to nothing:\n  ${hits.join('\n  ')}\n` +
        `react-native-css emits no declaration for an undeclared token, so the property is ` +
        `absent and RN falls back to its own default — black text, no border colour — with ` +
        `nothing thrown and nothing logged. Name a token declared in ` +
        `apps/native/src/global.css (foreground, muted-foreground, ink-2, faint, error, hair, ` +
        `line, …). A default Tailwind palette colour is reported here on purpose: rule 4 says ` +
        `colours come from the token set. A new NON-colour utility goes in NON_COLOR_CLASS.`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 27 — a date/time formatter always speaks localeTag(), never a bare Locale (#502)
// ---------------------------------------------------------------------------------------

/**
 * `toLocaleDateString(locale)` compiles: `Locale` is `'it' | 'en'`, both are valid BCP-47
 * tags, and `'en'` resolves byte-identically to en-US — month-first dates and a 12-hour
 * clock on a member-facing surface whose canonical language pairs Italian with en-GB.
 * That is #502: the chat day separator shipped American dates for anyone in English, and
 * no grep for `'en-US'` could find it, because the literal never appears. The mapping has
 * one home, `localeTag()` (`packages/i18n/src/locale-tag.ts`), and `locale-tag.test.ts`
 * pins `en-GB ≠ en-US`; this section makes the raw form unable to recur here.
 *
 * The rule is per call line: any `toLocaleDateString` / `toLocaleTimeString` /
 * `toLocaleString` / `new Intl.DateTimeFormat` / `new Intl.NumberFormat` must name
 * `localeTag(` on the same line. Every conforming site does (`lib/time.ts`,
 * `(modal)/star.tsx`), because the tag is the first argument. A zero-argument call is a
 * violation too — it formats in the DEVICE locale, which is not the signed-in locale §14
 * resolves. The one deliberate exception is `lib/locale.ts`'s
 * `Intl.DateTimeFormat().resolvedOptions().locale`: that call is not formatting anything —
 * it is how the device locale is DISCOVERED before any profile exists, which is the single
 * place the device locale is allowed to matter (`Intl` is callable without `new`, so the
 * pattern matches both spellings — which is also why that probe needs the exception at all).
 *
 * ## What it cannot see
 *
 * A call whose argument list wraps to the next line would slip through the same-line
 * check; none exists today, and the remedy is to keep the tag on the call line. The two
 * `apps/web` halves of #502 (the countdown, the admin waitlist) are out of this file's
 * reach — this suite walks `apps/native/src` only — so the web form CAN recur; it went
 * through review with that recorded rather than growing a second audit file.
 */
describe('date/time formatting always goes through localeTag() (#502)', () => {
  const FORMATTER =
    /\.toLocale(?:Date|Time)?String\s*\(|(?:new\s+)?Intl\.(?:DateTimeFormat|NumberFormat)\s*\(/;
  const DEVICE_LOCALE_PROBE = 'lib/locale.ts';

  it('every formatter call site names localeTag on the call line', () => {
    const hits = codeLines().filter(
      ([where, text]) =>
        FORMATTER.test(text) &&
        !text.includes('localeTag(') &&
        !where.includes(DEVICE_LOCALE_PROBE),
    );
    expect(
      hits.map(([where, text]) => `${where}  ${text.trim().slice(0, 120)}`),
      `a date/time formatter without localeTag():\n` +
        `A bare Locale ('en') resolves to en-US and a zero-argument call resolves to the ` +
        `device locale; both drift from the it-IT/en-GB pair the app speaks. Pass ` +
        `localeTag(locale) from @athanor/i18n as the first argument (#502).`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 28 — a toggle names itself, and a decorative mark is never spoken (#635)
// ---------------------------------------------------------------------------------------

/** Opening tags for `tag`, each with its raw attribute text, brace- and quote-aware. */
const openingTags = (src: string, tag: string): { line: number; attrs: string }[] => {
  const found: { line: number; attrs: string }[] = [];
  const re = new RegExp(`<${tag}(?=[\\s/>])`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let j = m.index + m[0].length;
    let depth = 0;
    let quote = '';
    while (j < src.length) {
      const c = src[j] as string;
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
      j += 1;
    }
    found.push({
      line: src.slice(0, m.index).split('\n').length,
      attrs: src.slice(m.index + m[0].length, j),
    });
  }
  return found;
};

/**
 * Two halves of the VoiceOver wave that a walk can actually see. The rest of #635 — a composed
 * label, a `checked` state, the peek card leaving the a11y tree — is per-site judgement no regex
 * can hold. These two are mechanical, and both regressed silently before.
 *
 * ## A bare `Switch` is an unnamed control
 *
 * A switch has a role and a checked state, and NOTHING else. The label `Text` beside it in the
 * row is a sibling, not an association — there is no `htmlFor` here — so a `Switch` with no
 * `accessibilityLabel` announces as «attivato, interruttore» with no subject. Eleven platform
 * switches shipped that way across `trust.tsx` and `notif-prefs.tsx`, which was every switch the
 * app had at the time. Since 2026-10-04 the tag is the app's own `components/Switch.tsx` (#921),
 * whose type requires the label; this walk stays, because a type does not see an empty string
 * and the register below is what makes a new toggle screen get read.
 *
 * The check is per-JSX-site, not per-runtime-control: `notif-prefs.tsx` renders six switches
 * from one tag inside `PREF_ROWS.map`, so a count here would be a number that rots. The property
 * is "every `<Switch` opening tag carries the attribute", which stays true however many rows the
 * list grows.
 *
 * ## A ✦ in an imperative announcement is spoken
 *
 * A RENDERED glyph can be marked decorative (`accessibilityElementsHidden` + the Android
 * sibling), and roughly twenty-five sites do exactly that. `AccessibilityInfo.announceForAccessibility`
 * has no element to mark: whatever is in the string is what VoiceOver says, and dozens of
 * catalog values carry a ✦ or ✧ as pure ornament. `ToastHost` is the only caller that announces a
 * member-facing catalog string, so `spoken()` (`lib/star.ts`) is the one seam and this pins it
 * there. What `spoken()` actually does is asserted in `star.test.ts`, beside the vocabulary it
 * removes; this section only checks that nothing announces around it.
 */
describe('a11y: toggles name themselves and ornaments stay silent (#635)', () => {
  // A row that IS the toggle (#748: the two composers' «passo del percorso») is `Row checked`
  // since 2026-10-06: the row is the control and `Row.tsx` draws the Switch hidden and
  // touch-inert inside it. That Switch still carries the label, so the rule below holds without
  // an exception and a later un-hiding cannot ship unnamed.
  const SWITCH_FILES = [
    'app/(modal)/trust.tsx',
    'app/(modal)/notif-prefs.tsx',
    'components/Row.tsx',
  ];
  const ANNOUNCE = /AccessibilityInfo\.announceForAccessibility\(/;

  it('finds the Switch sites it is walking', () => {
    const total = FILES.filter((p) => !isTest(p)).reduce(
      (n, p) => n + openingTags(stripComments(read(p)), 'Switch').length,
      0,
    );
    // A scanner that finds nothing passes every assertion below.
    expect(total, 'no <Switch> found at all — the walk is broken, not the tree').toBeGreaterThan(0);
  });

  it('every Switch carries an accessibilityLabel', () => {
    const unnamed = FILES.filter((p) => !isTest(p)).flatMap((p) =>
      openingTags(stripComments(read(p)), 'Switch')
        .filter(({ attrs }) => !/\baccessibilityLabel=/.test(attrs))
        .map(({ line }) => `${rel(p)}:${line}`),
    );
    expect(
      unnamed,
      `an unnamed <Switch>:\n` +
        `A switch has a role and a checked state, and nothing else — the label ` +
        `Text beside it is an unassociated sibling, so this toggle announces with no subject. ` +
        `Pass accessibilityLabel with the SAME key the visible label renders, so the two ` +
        `cannot drift (#635).`,
    ).toEqual([]);
  });

  it('the Switch sites are exactly the screens this section names', () => {
    const owners = FILES.filter((p) => !isTest(p))
      .filter((p) => openingTags(stripComments(read(p)), 'Switch').length > 0)
      .map((p) => rel(p).replace('apps/native/src/', ''))
      .sort();
    // Not decoration: a NEW screen with a Switch is exactly the case that would ship unnamed,
    // and this fails when one appears so the assertion above is read rather than trusted.
    expect(owners).toEqual([...SWITCH_FILES].sort());
  });

  it('the hook and the toast host each still announce', () => {
    /*
      A scanner that finds nothing passes the invariant below without checking anything, so this
      is the find-something half. It names the two files that MUST announce rather than counting
      the calls: a count is a fact about how the code is spelled, and this one already went red
      once for a refactor that folded two identical calls into a shared helper — the same
      failure mode the invariant test below was rewritten to avoid. `lib/a11y.ts` is the hook
      every transient message goes through and `ToastHost.tsx` is the global host; either one
      losing its announcement is a real regression, and neither is about arithmetic.
    */
    const owners = codeLines()
      .filter(([, text]) => ANNOUNCE.test(text))
      .map(([where]) => where.split(':')[0] as string);
    expect(
      owners.some((f) => f.endsWith('lib/a11y.ts')),
      `lib/a11y.ts no longer announces:\n` +
        `useAnnounceOnMount is the only iOS path a transient message has — ` +
        `accessibilityLiveRegion is Android-only, so a check-in verdict or a deck toast that ` +
        `stops going through this hook is silent on the platform testers hold (#635).`,
    ).toBe(true);
    expect(
      owners.some((f) => f.endsWith('components/ToastHost.tsx')),
      `components/ToastHost.tsx no longer announces:\n` +
        `The global host is what speaks every toast on iOS. If this call is gone, every ` +
        `showToast in the app became silent there and the walk below has nothing to check (#635).`,
    ).toBe(true);
  });

  it('every announcement is wrapped in spoken()', () => {
    /*
      Prettier decides where the argument goes, so the invariant cannot be "on this line": a
      call whose argument does not fit wraps, and an earlier version of this guard pinned the
      NUMBER of wrapped calls — which then failed the moment an unrelated edit lengthened one.
      The property is `spoken(` opening the argument, whether that lands on the call line or the
      one below it. Nothing else may appear between them: `announceForAccessibility(` followed
      by anything that is not `spoken(` is a hit.
    */
    const raw = CODE_LINES.flatMap(([p, ls]) =>
      ls
        .map((text, i) => [text, ls[i + 1] ?? '', i + 1] as const)
        .filter(([text]) => ANNOUNCE.test(text))
        .filter(([text, next]) =>
          /announceForAccessibility\($/.test(text.trim())
            ? !/^spoken\(/.test(next.trim())
            : !/announceForAccessibility\(\s*spoken\(/.test(text),
        )
        .map(([text, , line]) => `${rel(p)}:${line}  ${text.trim().slice(0, 100)}`),
    );
    expect(
      raw,
      `an announcement that does not strip its ornament:\n` +
        `An imperative announcement has no element to mark decorative, so every ✦/✧ in the ` +
        `string is SPOKEN. Wrap the argument in spoken() (lib/star.ts), the way every other ` +
        `call site does (#635).`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 29 — a tap target is 44pt on the DEVICE, not just in the browser (#638)
// ---------------------------------------------------------------------------------------

/**
 * DESIGN §10 is one unqualified clause — «Tap targets ≥ 44pt» — and G2/A-1 gates the release
 * on it. Both halves below exist because the obvious way to satisfy that clause measures
 * PASSING on the only harness this repo can run and FAILING on the device it ships to.
 *
 * ## `h-11` was 44 on web and 38.5 on device
 *
 * Until 2026-10-04 (#921) a spacing step was 3.5px on device: Tailwind's step is 0.25rem and
 * `react-native-css` inlines `rem` at **14** (DESIGN §11, 2026-08-30). The eleven-step
 * utilities that read as «44» were 38.5pt where it counts, and eleven sites shipped that way —
 * one of them under a comment that claimed «a real 44pt tap target» — because
 * `getBoundingClientRect` in the expo-web walk returned 44 for every one of them. `global.css`
 * now states the step in px (`--spacing: 4px`, pinned by `tokens-mirror.test.ts`), so the class
 * is 44 on both. The arbitrary form `h-[44px]` is a literal whatever a step measures.
 *
 * The ban stays, and it is on the CLASS, not on a measurement: eleven steps is only ever an
 * attempt at the floor, so the floor keeps one spelling, and that spelling does not lean on a
 * line of the stylesheet.
 *
 * ## A bare `Pressable` is whatever its text happens to measure
 *
 * A `Pressable` with no `className`, no `style` and no `hitSlop` is exactly its child's line
 * box. Around a 12px label that is ~15pt, and eight of them shipped — «Rispondi» beside a
 * «Elimina» that had the same defect, the winner's edit/withdraw/save/cancel on published
 * progress, both photo controls on the edit form, and the pair the issue did list in
 * onboarding. None is visible as a defect in review: the control looks right, it is only
 * small. So the shape itself is the assertion, and a target that genuinely inherits its size
 * from a large child is named here rather than left to be inferred.
 *
 * ## What this section deliberately does NOT pin
 *
 * There is a third shape in the same family — a small label or a bare glyph leaning on the
 * shared `HIT_SLOP` — and it is NOT asserted here, so do not read a green §29 as «§10 is
 * covered». `HIT_SLOP` is 11 each side and its docstring sizes it for a 22pt icon, which
 * reaches exactly 44; it is CORRECT at that size and short only when the visual is smaller.
 * Deciding that statically means knowing what the child renders to, and a scan for «a small
 * `text-[Npx]` somewhere in the body» flags ~26 sites of which several are plainly fine
 * (`StoryRing`'s Pressable wraps a 56pt avatar, `DreamCard`'s add-milestone one a whole row) — a
 * guard whose allowlist would be longer than its findings is a pin on today's tree, not an
 * invariant. §28 makes the same call in as many words for the rest of #635.
 *
 * The two instances #638's sweep did fix by hand — `home/TodaySection.tsx` and
 * `(tabs)/costellazioni.tsx`, plus the `(tabs)/community.tsx` glyph — were found by reading,
 * not by this file. The remaining sites need a per-site measurement on a device and are named
 * in the PR rather than silently claimed.
 *
 * Neither half below can be checked by the expo-web walk (`/mobile-qa`): every fix measures
 * IDENTICALLY in the browser before and after, which is the whole reason the trap survived.
 */
describe('a11y: a tap target clears 44pt on the device (#638)', () => {
  /**
   * A bare Pressable whose size legitimately comes from a large child. Keyed by `file:line`,
   * not by file: a file-wide key would silently exempt the NEXT bare Pressable added there,
   * which is the one nobody looked at. The line moving is the point — it forces a re-read.
   */
  const BARE_PRESSABLE_OK: Record<string, string> = {
    'components/profile/DreamCard.tsx:88':
      'wraps <DreamQuote>, a multi-line quote block that is far taller than the floor',
  };

  // `size-*` is Tailwind v4's both-axes shorthand and would be the other way to spell the
  // trap. Unused in this app today, banned anyway so it cannot arrive as the workaround.
  const REM_44 = /\b(?:min-)?(?:[hw]|size)-11\b/;

  const pressables = (p: string) =>
    jsxOpeningTags(stripComments(read(p))).filter((t) => t.base === 'Pressable');

  it('finds the Pressable sites it is walking', () => {
    const total = FILES.filter((p) => !isTest(p)).reduce((n, p) => n + pressables(p).length, 0);
    // A scanner that finds nothing passes both assertions below. ~177 tags today.
    expect(total, 'no <Pressable> found at all — the walk is broken, not the tree').toBeGreaterThan(
      100,
    );
  });

  it('no eleven-step height or width stands in for the 44pt floor', () => {
    const hits = codeLines()
      .filter(([, text]) => REM_44.test(text))
      .map(([where, text]) => `${where}  ${text.trim().slice(0, 100)}`);
    expect(
      hits,
      `an \`h-11\`/\`w-11\` used as the 44pt floor:\n` +
        `The 44pt floor has one spelling here, the literal. The class is 44 only while ` +
        `global.css states \`--spacing: 4px\`; before 2026-10-04 it was 38.5pt on device. Write ` +
        `the literal \`h-[44px]\`/\`w-[44px]\`, or \`min-h-[44px]\` where the box grows (#638).`,
    ).toEqual([]);
  });

  it('every Pressable declares its own geometry, or is named as inheriting it', () => {
    const bare = FILES.filter((p) => !isTest(p)).flatMap((p) =>
      pressables(p)
        .filter(
          ({ attrs }) =>
            !/\bclassName=/.test(attrs) && !/\bstyle=/.test(attrs) && !/\bhitSlop=/.test(attrs),
        )
        .map(({ line }) => `${rel(p).replace('apps/native/src/', '')}:${line}`),
    );
    const unexplained = bare.filter((hit) => BARE_PRESSABLE_OK[hit] === undefined);
    expect(
      unexplained,
      `a Pressable with no geometry of its own:\n` +
        `With no className, style or hitSlop this target is exactly its child's line box — ` +
        `~15pt around a 12px label, under §10's 44pt floor and invisible in review because ` +
        `the control still LOOKS right. Give it \`min-h-[44px] min-w-[44px] items-center ` +
        `justify-center\`, or add it to BARE_PRESSABLE_OK with the large child it inherits ` +
        `its size from. BARE_PRESSABLE_OK is keyed by \`file:line\`, so an ALREADY-listed ` +
        `site reappearing here usually just moved — bump its key rather than re-solving it, ` +
        `and re-read it while you are there, which is why the key carries the line (#638).`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 30 — Dynamic Type
// ---------------------------------------------------------------------------------------

describe('a11y: text scales, and the box holding it grows (#639)', () => {
  /**
   * Every fixed PIXEL height left in the tree, each with the reason its box cannot simply
   * grow. Keyed by `file:line` for the same reason §29's roster is: a file-wide key would
   * exempt the next fixed height added there, which is the one nobody looked at.
   *
   * The rule this encodes: a height a member's text size cannot move is a clip waiting to
   * happen, so it is allowed only where nothing inside it is prose — a media thumbnail, a
   * 2-3px rule, a spinner well — or where the box is a MEASURED constant and the glyph
   * inside it is capped to `FONT_SCALE_CAP.ornament` instead.
   */
  const FIXED_HEIGHT_OK: Record<string, string> = {
    'app/(modal)/chat.tsx:469':
      'measured 20pt remove-badge on a thumbnail; its ✕ is capped to `ornament`',
    'app/(modal)/chat.tsx:524':
      'the send disc — `rounded-full` on a box that grew in one axis is an ellipse; its ' +
      'chevron is capped to `ornament`',
    'app/(modal)/post-compose.tsx:385': 'same measured 20pt remove-badge as chat.tsx:469',
    'app/(modal)/story-compose.tsx:161': 'same measured 20pt remove-badge as chat.tsx:469',
    'components/Switch.tsx:59': 'the 22pt knob of the switch: a drawn disc, no prose inside',
    'app/(onboarding)/index.tsx:462':
      'the local-photo disc (an Avatar shape, without Avatar); its ✦ placeholder is capped ' +
      'to `ornament` and hidden from assistive tech',
    'components/StepBars.tsx:23': 'a 3px progress rule — no text inside',
    'components/StepBars.tsx:24': 'a 3px progress rule — no text inside',
    'components/stories/StoriesViewer.tsx:372': 'the reply send disc — same reason as chat.tsx:524',
    'components/search/ResultRow.tsx:73':
      'the 44pt disc of a project or an event result; its glyph is capped to `ornament`',
    'components/trust/NotificationRow.tsx:51':
      'the 30pt disc that leads a notification; its glyph is capped to `ornament`',
  };

  const TW = `${SRC}tw/index.tsx`;

  it('both text primitives carry the policy, and it comes from the one module', () => {
    // Whitespace-collapsed: prettier wraps the ternary across four lines.
    const tw = stripComments(read(TW)).replace(/\s+/g, ' ');
    // `=== undefined`, never `??`: an explicit `maxFontSizeMultiplier={undefined}` must
    // still land on the cap, while `null` — RN's "inherit from the parent Text" — must
    // reach RN intact, or a nested run under a tighter cap silently jumps back to 2x.
    expect(
      /maxFontSizeMultiplier: props\.maxFontSizeMultiplier === undefined \? FONT_SCALE_CAP\.text : props\.maxFontSizeMultiplier/.test(
        tw,
      ),
      'src/tw no longer defaults maxFontSizeMultiplier from FONT_SCALE_CAP.text in the exact ' +
        'shape #639 requires — `=== undefined ? FONT_SCALE_CAP.text : props…`. Losing the ' +
        'default returns the whole app to unbounded scaling into fixed geometry; writing it ' +
        'as `??` instead swallows an explicit null, which RN reads as "inherit from the ' +
        'parent Text".',
    ).toBe(true);
    for (const primitive of ['RNText', 'RNTextInput']) {
      expect(
        new RegExp(`useCssElement\\(${primitive}, withTextDefaults\\(props\\)`).test(tw),
        `src/tw's ${primitive} wrapper stopped going through withTextDefaults — it now ships ` +
          `without the Dynamic Type cap AND without the app font (#639)`,
      ).toBe(true);
    }
  });

  it('a live text-size change remounts every Text, and nothing that holds state (#754)', () => {
    const tw = stripComments(read(TW)).replace(/\s+/g, ' ');
    expect(
      /export const Text = \(props: TextProps\) => <TextImpl key=\{useFontScale\(\)\} \{\.\.\.props\} \/>/.test(
        tw,
      ),
      'src/tw Text is no longer keyed on useFontScale(). A Dynamic Type change made while the ' +
        'app runs then re-renders every Text at the new size inside the OLD layout — rows sized ' +
        'for the previous scale, lines clipped or gapped — until the screen is left (#754).',
    ).toBe(true);
    expect(
      tw.match(/useFontScale\(\)/g)?.length,
      'useFontScale() keys exactly one wrapper — Text. Keying TextInput would drop focus and ' +
        'reset an uncontrolled draft on every text-size change; keying a container would ' +
        'remount its whole subtree, state included.',
    ).toBe(1);
    const outside = codeLines()
      .filter(([where]) => !where.startsWith('apps/native/src/tw/'))
      .filter(([, text]) => /\buseFontScale\b/.test(text))
      .map(([where, text]) => `${where}  ${text.trim().slice(0, 100)}`);
    expect(
      outside,
      'useFontScale outside src/tw: it exists to key the Text leaf and nothing else. A screen ' +
        'that keys a container on it remounts that subtree — drafts, focus, scroll — on every ' +
        'text-size change; read `useWindowDimensions().fontScale` for a size instead (#754).',
    ).toEqual([]);
    const root = stripComments(read(`${SRC}app/_layout.tsx`));
    expect(
      /<FontScaleProvider>/.test(root),
      'the root layout no longer mounts FontScaleProvider, so useFontScale() reads its default ' +
        'of 1 forever and the Text key never changes (#754)',
    ).toBe(true);
  });

  it('no call site invents its own cap', () => {
    const hits = codeLines()
      .filter(([where]) => !where.startsWith('apps/native/src/tw/'))
      .filter(([, text]) => /maxFontSizeMultiplier=\{(?!FONT_SCALE_CAP\.)/.test(text))
      .map(([where, text]) => `${where}  ${text.trim().slice(0, 100)}`);
    expect(
      hits,
      "a maxFontSizeMultiplier that is not one of FONT_SCALE_CAP's three values:\n" +
        'The policy is only a policy while it lives in `lib/type-scale.ts` — a bare number ' +
        'here is a per-screen opinion nobody can audit, and a number below 2 silently puts ' +
        'that screen under the WCAG 200% floor (#639).',
    ).toEqual([]);
  });

  it('a header never truncates to a single line', () => {
    const hits = FILES.filter((p) => !isTest(p)).flatMap((p) =>
      jsxOpeningTags(stripComments(read(p)))
        // `base === 'Text'`, because `raw` is the UNBLANKED window (§21's note): a
        // `<FlatList ListHeaderComponent={<Text …>}>` would otherwise answer for the tag
        // nested inside it, which jsxOpeningTags already emits on its own.
        .filter(
          ({ base, raw }) =>
            base === 'Text' &&
            /accessibilityRole=["']header["']/.test(raw) &&
            // Anything but a literal ≥2 or `wordLines(…)` (#754), which gives one line only
            // to a one-word title — the one case where a second line splits the word.
            /numberOfLines=\{(?![2-9]\}|wordLines\()/.test(raw),
        )
        .map(({ line }) => `${rel(p).replace('apps/native/src/', '')}:${line}`),
    );
    expect(
      hits,
      'a screen title pinned to one line:\n' +
        "A header IS the screen's name, and one line at AX sizes leaves «Impostazion…» " +
        'where the orientation should be. Headers sit in bands with no fixed height, so a ' +
        'second line costs nothing at the default size (#639). Use a literal 2, or ' +
        '`wordLines(title)` from lib/word-lines, which drops to one line only for a one-word ' +
        'title — the second line there could only split the word (#754).',
    ).toEqual([]);
  });

  it('finds the fixed heights it is walking', () => {
    const total = codeLines().filter(([, t]) => /(?<![\w-])h-\[\d+px\]/.test(t)).length;
    // A scanner that finds nothing passes the assertion below. 11 today.
    expect(
      total,
      'no fixed pixel height found at all — the walk is broken, not the tree',
    ).toBeGreaterThan(5);
  });

  it('every fixed pixel height says why it cannot grow', () => {
    const unexplained = codeLines()
      .filter(([, text]) => /(?<![\w-])h-\[\d+px\]/.test(text))
      .map(([where]) => where.replace('apps/native/src/', ''))
      .filter((hit) => FIXED_HEIGHT_OK[hit] === undefined);
    expect(
      unexplained,
      'a fixed pixel height with no reason on record:\n' +
        "A height the member's text size cannot move clips instead of growing — the whole " +
        'of #639. Write `min-h-[Npx]` so the floor stays and the box grows, or add the site ' +
        'to FIXED_HEIGHT_OK saying what stops it (no prose inside, or a measured box whose ' +
        'glyph is capped to FONT_SCALE_CAP.ornament). The registry is keyed by `file:line`, ' +
        'so an ALREADY-listed site reappearing here has usually just moved — bump its key ' +
        'and re-read it while you are there, which is why the key carries the line.',
    ).toEqual([]);
  });

  it('finds the header tags it is walking', () => {
    const total = FILES.filter((p) => !isTest(p)).reduce(
      (n, p) =>
        n +
        jsxOpeningTags(stripComments(read(p))).filter(
          ({ base, raw }) => base === 'Text' && /accessibilityRole=["']header["']/.test(raw),
        ).length,
      0,
    );
    // A scanner that finds nothing passes the header assertion above. 33 today (#651 wired
    // the eyebrow+title screens; the floor stays at 10, which is a floor and not a count).
    expect(total, 'no header Text found at all — the walk is broken, not the tree').toBeGreaterThan(
      10,
    );
  });

  it('no text primitive is imported from react-native outside the wrappers', () => {
    // This is what makes `src/tw`'s claim true. §6 only flags an RN-imported tag that ALSO
    // carries a className, so `<Text style={…}>` straight from react-native slipped past it
    // and would ship with no cap, no app font, and nothing to notice it.
    const hits = FILES.filter((p) => !isTest(p) && !p.startsWith(`${SRC}tw/`)).flatMap((p) => {
      const src = stripComments(read(p));
      return [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]react-native['"]/g)]
        .flatMap((m) => (m[1] as string).split(','))
        .map((spec) =>
          spec
            .trim()
            .split(/\s+as\s+/)[0]
            ?.trim(),
        )
        .filter((name) => name === 'Text' || name === 'TextInput')
        .map((name) => `${rel(p)}  imports ${name}`);
    });
    expect(
      hits,
      'a text primitive imported straight from react-native:\n' +
        'It arrives without the Dynamic Type cap AND without the app font, and neither ' +
        'absence is visible in review. Import from `@/tw` (#639).',
    ).toEqual([]);
  });

  it('no call site switches font scaling off outright', () => {
    // The other way to opt out, and the one `maxFontSizeMultiplier` guards cannot see.
    const hits = codeLines()
      .filter(([, text]) => /allowFontScaling=\{false\}/.test(text))
      .map(([where, text]) => `${where}  ${text.trim().slice(0, 100)}`);
    expect(
      hits,
      'allowFontScaling={false}:\n' +
        "That is not a cap, it is an opt-out — the text stops responding to the member's " +
        'setting entirely. If a glyph genuinely cannot grow, cap it to ' +
        'FONT_SCALE_CAP.ornament and say why at the call site (#639).',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 31 — a composer confirms before it throws a draft away (#636)
// ---------------------------------------------------------------------------------------

/**
 * `useGuardedBack` (§23) answers "where does this screen exit TO". Nothing answered "may it
 * exit at all", so every composer in the app discarded typed work in silence: one swipe down
 * on an iOS sheet took a dream, a post body with up to ten staged media, or seven steps of
 * candidacy prose, with no confirmation and no undo.
 *
 * The guard is `useDirtyGuard` (`src/hooks/use-dirty-guard.ts`), and it is deliberately ONE
 * call per screen rather than a change at each exit: `usePreventRemove` intercepts the removal
 * itself, so the header chevron, the Android hardware back button, the iOS sheet swipe-down and
 * the left-edge back-swipe are all covered together and none of them can be forgotten
 * separately.
 *
 * ## Why the roster is a list and not a scan
 *
 * "Holds a draft" is a claim about meaning, not about syntax — `search-filters` binds text to
 * state too and loses nothing worth confirming. So the roster is written down, and the
 * discovery assertion below is what stops the list going stale: any `(modal)` screen that binds
 * a `Field`, `Input` or `TextInput` to state and appears in neither the roster nor the
 * register fails,
 * which turns a new composer into a decision someone has to make rather than an omission.
 *
 * ## What it cannot see
 *
 * That the `dirty` argument is CORRECT — a screen passing `dirty={false}` satisfies every
 * assertion here and guards nothing. The comparison itself is unit-tested
 * (`src/lib/dirty-guard.test.ts`); this pins the wiring.
 *
 * The other thing a grep cannot see is DUPLICATION. `usePreventRemoveContext` is a React
 * context object, so the hook and the navigator must share one physical copy of
 * react-navigation; under two copies the hook fills a context the navigator never reads and
 * every guard below goes dead with this section still green. expo-router 57 vendors its copy,
 * which makes the identity structural — so the identity test asserts the vendored copy is
 * where this section thinks it is, and that no standalone `@react-navigation/*` comes back.
 */
const DIRTY_GUARD_ROSTER = [
  'app/(modal)/dream-editor.tsx',
  'app/(modal)/post-compose.tsx',
  // The comment composer at the foot of a post — an `Input`, not a `Field`.
  'app/(modal)/post/[id].tsx',
  'app/(modal)/story-compose.tsx',
  'app/(modal)/project-compose.tsx',
  'app/(modal)/milestone.tsx',
  'app/(modal)/help.tsx',
  'app/(modal)/chat.tsx',
  'app/(modal)/candidacy.tsx',
  'app/(modal)/event-create.tsx',
  'app/(modal)/plan.tsx',
  'app/(modal)/progress.tsx',
  'app/(modal)/report.tsx',
  // Not a route: an `editing` flag inside the persistent Profilo tab, so nothing is ever
  // removed and `usePreventRemove` cannot fire. It takes `useDiscardConfirm` on BOTH its
  // «Annulla» controls — §33 pins the one at the head of the form (#659).
  'components/profile/ProfileEditForm.tsx',
];

/**
 * `(modal)` screens that bind text to state and are deliberately NOT guarded, with the reason.
 * A filter is not a draft: closing one loses a choice that costs a tap to remake.
 */
const NO_DRAFT_TO_GUARD: Record<string, string> = {
  'app/(modal)/search.tsx': 'a query, re-typed in a second; the screen IS the search',
  'app/(modal)/connections.tsx': 'a filter field over a list, not authored content',
  'app/(modal)/search-filters.tsx': 'filter choices, not authored content',
  'app/(modal)/event-filters.tsx': 'filter choices, not authored content',
  'app/(modal)/new-message.tsx': 'a recipient picker; the message itself is composed in chat',
  'app/(modal)/new-password.tsx': 'a credential field, force-presented and re-presented',
  'app/(modal)/delete-account.tsx': 'type-to-confirm; the whole point is that it is retyped',
  'app/(modal)/verify.tsx': 'identity handoff, no authored draft',
  'app/(modal)/circle.tsx': 'membership CTAs, no authored draft',
  'app/(modal)/favor.tsx': 'a confirm sheet, no free text',
};

/** `useDirtyGuard(` or `useDiscardConfirm(` — the two shapes of the one primitive. */
const GUARD_CALL = /\buse(?:DirtyGuard|DiscardConfirm)\s*\(/;

describe('a composer confirms before it throws a draft away (#636)', () => {
  it('finds the screens it is walking', () => {
    // Tracks the roster rather than carrying a number of its own. The usual shape here is a
    // slack FLOOR, because the set being walked is DISCOVERED and its size moves on its own;
    // this roster is an explicit list, so its length is known exactly and a hand-written floor
    // could only drift below it — as it did, sitting at 12 while the roster grew to 14.
    const present = DIRTY_GUARD_ROSTER.filter((p) => FILES.some((f) => rel(f).endsWith(p)));
    expect(
      present.length,
      'the dirty-guard roster no longer resolves to files on disk — have these screens been ' +
        'renamed? This section is vacuous until the paths match again.',
    ).toBe(DIRTY_GUARD_ROSTER.length);
  });

  it('both lists name files that exist', () => {
    // A register entry whose file was renamed or deleted stops exempting anything and starts
    // rotting in silence — and a roster entry that no longer resolves would be skipped by the
    // assertion below rather than failing it.
    const missing = [...DIRTY_GUARD_ROSTER, ...Object.keys(NO_DRAFT_TO_GUARD)].filter(
      (suffix) => !FILES.some((f) => rel(f).endsWith(suffix)),
    );
    expect(
      missing,
      'a dirty-guard roster or NO_DRAFT_TO_GUARD entry names a file that is not on disk — ' +
        'drop it, or fix the path (#636).',
    ).toEqual([]);
  });

  it('every screen on the roster calls the guard', () => {
    const unguarded = DIRTY_GUARD_ROSTER.filter((suffix) => {
      const file = FILES.find((f) => rel(f).endsWith(suffix));
      return file ? !GUARD_CALL.test(stripComments(read(file))) : false;
    });
    expect(
      unguarded,
      'a composer that discards typed work without asking. Add `useDirtyGuard({ dirty, ... })` ' +
        'from src/hooks/use-dirty-guard.ts — one call covers the chevron, the hardware back ' +
        'button and the sheet swipe together (#636).',
    ).toEqual([]);
  });

  it('a new (modal) composer is a decision, not an omission', () => {
    // `Input` as well as `Field`/`TextInput` — the tree has three text wrappers, and a scan
    // that knew only two left `post/[id].tsx`'s comment composer unguarded AND unregistered
    // while this section read green (caught in review of #636).
    const bound = /<(?:Field|Input|TextInput)\b[^>]*\bvalue=\{/;
    const undeclared = FILES.filter((p) => !isTest(p) && p.includes('/app/(modal)/')).flatMap(
      (p) => {
        // `rel()` yields `apps/native/src/app/(modal)/x.tsx`; both lists are keyed from
        // `app/` down, so the prefix to strip includes `src/`. Stripping only `apps/native/`
        // left every register lookup missing its key — latent until the scan widened to
        // `Input` and started matching files that are on the lists.
        const key = rel(p).replace('apps/native/src/', '');
        if (DIRTY_GUARD_ROSTER.includes(key) || key in NO_DRAFT_TO_GUARD) return [];
        const code = stripComments(read(p));
        if (!bound.test(code) || GUARD_CALL.test(code)) return [];
        return [key];
      },
    );
    expect(
      undeclared,
      'a (modal) screen binds a text field to state, guards nothing, and is on neither list. ' +
        'Either give it `useDirtyGuard` or add it to NO_DRAFT_TO_GUARD with the reason it ' +
        'loses nothing worth confirming (#636).',
    ).toEqual([]);
  });

  it('the hook and the navigator are one vendored react-navigation', () => {
    // `usePreventRemoveContext` is a React context OBJECT. On SDK 54 the risk was two npm
    // copies of `@react-navigation/native`; SDK 56 dropped expo-router's react-navigation
    // dependency and VENDORED it, so `usePreventRemove` and native-stack's `isRemovePrevented`
    // are now two files inside ONE package and the identity holds by construction. Two
    // assertions keep that from going vacuous — the vendored copy is where this section
    // thinks it is — one asserts the identity itself, and two assert the new way to break it: a
    // standalone `@react-navigation/*` added back, which would give the hook a context the
    // navigator never reads, with every grep above still green (#636, #508).
    const req = createRequire(`${SRC}package.json`);
    expect(
      () => req.resolve('expo-router/react-navigation'),
      'expo-router stopped exporting its vendored react-navigation at expo-router/react-navigation, ' +
        'so the prevent-remove context the hook fills is not the one the navigator reads.',
    ).not.toThrow();
    expect(
      () => req.resolve('expo-router/build/react-navigation/native-stack'),
      'expo-router no longer vendors native-stack. This section assumes the hook and the ' +
        'navigator are one package — re-derive the identity before trusting the guards above.',
    ).not.toThrow();
    // Identity, not existence: a subpath resolved from one base always lands under that base's
    // copy, so the way two copies sneak in is the INSTALL — two expo-router versions locked at
    // once, or an installed copy that is not the locked one. The lockfile is the record CI
    // installs from (`node_modules/.pnpm` keeps stale dirs and cannot be counted), and turbo's
    // global hash already covers it.
    const lock = read(`${NATIVE}../../pnpm-lock.yaml`);
    const locked = [...new Set([...lock.matchAll(/^ {2}expo-router@([^(:]+)/gm)].map((m) => m[1]))];
    expect(
      locked,
      'more than one expo-router version is locked, so two physical copies of the vendored ' +
        'react-navigation exist and the hook and the navigator can resolve different ones (#636).',
    ).toHaveLength(1);
    const installed = (
      JSON.parse(read(req.resolve('expo-router/package.json'))) as { version: string }
    ).version;
    expect(
      installed,
      'the expo-router this app resolves is not the locked one — the install drifted from the ' +
        'lockfile, and the identity argument above is about the lockfile.',
    ).toBe(locked[0]);
    expect(
      /from 'expo-router\/react-navigation'/.test(read(`${SRC}hooks/use-dirty-guard.ts`)),
      'use-dirty-guard.ts stopped taking usePreventRemove from expo-router/react-navigation.',
    ).toBe(true);

    const pkg = JSON.parse(readFileSync(`${NATIVE}package.json`, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const declared = Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    }).filter((name) => name.startsWith('@react-navigation/'));
    expect(
      declared,
      'a standalone @react-navigation/* is back in apps/native. expo-router 57 vendors its own ' +
        'copy; a second physical one means usePreventRemove fills a context native-stack never ' +
        'reads and every guard above goes dead, silently (#636, #508).',
    ).toEqual([]);

    const imports = [
      ...new Set(
        codeLines()
          .filter(([, text]) => /from '@react-navigation\//.test(text))
          .map(([at]) => at),
      ),
    ].sort();
    expect(
      imports,
      "import from 'expo-router/react-navigation' instead — apps/native declares no " +
        '@react-navigation package on SDK 57, so a bare import would resolve through a ' +
        'transitive copy or not at all.',
    ).toEqual([]);
  });

  it('the primitive still branches, so the roster cannot go vacuous', () => {
    const hook = stripComments(read(`${SRC}hooks/use-dirty-guard.ts`));
    expect(
      [/\busePreventRemove\s*\(/.test(hook), /\bshouldGuardExit\s*\(/.test(hook)],
      'src/hooks/use-dirty-guard.ts no longer calls usePreventRemove, or no longer defers to ' +
        'shouldGuardExit. Only usePreventRemove populates the prevent-remove context that ' +
        'native-stack reads to set `preventNativeDismiss`, so a `beforeRemove` listener in its ' +
        'place would let the iOS sheet dismiss natively while every assertion above stayed ' +
        'green.',
    ).toEqual([true, true]);

    const decision = stripComments(read(`${SRC}lib/dirty-guard.ts`));
    expect(
      [/'web'/.test(decision), /\bsaving\b/.test(decision), /\bsubmitted\b/.test(decision)],
      'shouldGuardExit stopped standing down on one of its three grounds. Each is load-bearing: ' +
        'web because Alert.alert is a no-op stub there and a prevented pop with no dialog ' +
        'strands the member; saving/submitted because a composer pops itself on success with ' +
        'the fields still full, and a guard without them fires hardest on the one path where ' +
        'nothing is at stake.',
    ).toEqual([true, true, true]);
  });
});

// ---------------------------------------------------------------------------------------
// 32 — a block or unblock drops the person's cached profile, not just the block rows
// ---------------------------------------------------------------------------------------

/**
 * `getProfileById` resolves to `null` for a blocked pair, and `useProfile` caches that null as
 * a success for five minutes (persisted 24h). Unblocking from «Profili bloccati» invalidated
 * only `blockKeys`, so the row vanished and the person stayed «non disponibile»; blocking from
 * the report sheet or the chat kebab had the mirror bug. `lib/block-cache.ts` is now the one
 * door, and this walks every `blockUser` / `unblockUser` call site to make sure it goes through
 * it — a fifth entry point written against `blockKeys.all` alone would compile, run, and fail
 * exactly the way the first four did.
 */
describe('a block or unblock drops the cached profile too', () => {
  /** Every line that writes a block row — app code only, a test mocking the writer is not one. */
  const writes = () =>
    codeLines().filter(
      ([at, text]) =>
        !at.endsWith('lib/block-cache.ts') &&
        !/\.test\.tsx?:\d+$/.test(at) &&
        /\b(?:un)?blockUser\s*\(/.test(text),
    );

  it('finds the block call sites at all', () => {
    expect(writes().length, 'no blockUser/unblockUser call found — has the api moved?').toBe(5);
  });

  it('every file that writes a block invalidates through invalidateBlockDependents', () => {
    const writers = [...new Set(writes().map(([at]) => at.replace(/:\d+$/, '')))].sort();
    const bare = writers.filter((w) => {
      const file = FILES.find((p) => rel(p) === w) as string;
      return !/\binvalidateBlockDependents\s*\(/.test(stripComments(read(file)));
    });
    expect(
      bare,
      'a screen writes a block without invalidateBlockDependents — the person keeps their ' +
        "cached profile (or cached null) for the rest of useProfile's window.",
    ).toEqual([]);
  });

  // Whole-file, not per line: prettier wraps a longer call onto three lines, and a line-scoped
  // regex would wave that form through.
  it('no call site invalidates blockKeys by hand any more', () => {
    const hand: string[] = [];
    for (const [p, ls] of CODE_LINES) {
      if (rel(p).endsWith('lib/block-cache.ts')) continue;
      const src = ls.join('\n');
      for (const m of src.matchAll(/invalidateQueries\(\s*\{\s*queryKey:\s*blockKeys\./g)) {
        hand.push(`${rel(p)}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(
      hand,
      'a hand-rolled blockKeys invalidation is the shape that shipped the bug — route it ' +
        'through invalidateBlockDependents so the profile, dream and momenti keys ride along.',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 33 — the profile editor's way out sits above its fields
// ---------------------------------------------------------------------------------------

/**
 * #659. The profile editor is a MODE, not a route: entering it unmounts the Profilo tab's own
 * share/settings/edit row, and until #659 nothing replaced it — the only exit was the «Annulla»
 * beneath eleven sections of form, so an accidental tap on «Modifica» cost a full scroll each
 * way.
 *
 * §31 cannot see that. It asks only whether the file calls the guard AT ALL, and the foot
 * «Annulla» answers for the file on its own: the head control could be deleted with every
 * assertion there still green. What this pins is POSITION — a way out before the first field —
 * and that it is the GUARDED way out, because a bare `onCancel` at the head would throw a dirty
 * draft away in silence, which is the failure #636 exists to stop.
 *
 * Position rather than a count, and no `file:line` key: the form above the exit is edited often,
 * so a line key would rot on changes that cannot affect this, and a count of the controls says
 * nothing about where any of them is.
 *
 * The honest limit: this pins the position of a CALL and of a PRESSABLE, not that they are the
 * same control. A `<Pressable>` above the fields wired to something else, plus a hoisted
 * `const cancel = () => confirmDiscard(…)` in the component body, would satisfy both indices
 * with nothing on screen to tap. Proving the wiring needs a render, which this harness has no
 * environment for (`vitest.config.ts` runs `environment: 'node'`).
 */
describe('the profile editor exits from the top, through the guard (#659)', () => {
  const EDITOR = `${SRC}components/profile/ProfileEditForm.tsx`;
  /** The first thing a member would have to scroll past. `Section` and `SectionLabel` are
      distinct tags — `<Section\b` does not match `<SectionLabel`, so both are named. */
  const FIELD = /<(?:Section|SectionLabel|Field)\b/;

  it('finds the editor and the fields it is walking', () => {
    expect(
      FILES.includes(EDITOR),
      'ProfileEditForm.tsx has moved — this section is vacuous until the path is fixed (#659).',
    ).toBe(true);
    expect(
      FIELD.test(stripComments(read(EDITOR))),
      'no <Section>/<SectionLabel>/<Field> found in the profile editor — the walk is broken, ' +
        'not the tree.',
    ).toBe(true);
  });

  it('the way out comes before the first field', () => {
    const code = stripComments(read(EDITOR));
    const exit = code.search(/\bconfirmDiscard\s*\(/);
    const field = code.search(FIELD);
    expect(
      exit,
      'ProfileEditForm no longer calls confirmDiscard anywhere — see §31 (#636).',
    ).toBeGreaterThan(-1);
    // The two halves are asserted separately, so a regression says WHICH one broke rather than
    // `false !== true`: a missing control and an unguarded one are different repairs.
    const WHY =
      'Entering edit mode unmounts the tab header, so a member who taps «Modifica» by ' +
      'accident is left with an exit under eleven sections of form and a full scroll each ' +
      'way. Keep a control at the head of the form, routed through the same ' +
      '`confirmDiscard({ dirty, saving }, onCancel)` as the one at the foot (#659).';
    // The control as well as the call: a `confirmDiscard` reached from an effect rather than a
    // press would satisfy the second index while leaving nothing on screen to tap.
    expect(
      code.search(/<Pressable\b/),
      `the profile editor has no PRESSABLE above its fields:\n${WHY}`,
    ).toBeLessThan(field);
    expect(exit, `the profile editor's way out is not above its fields:\n${WHY}`).toBeLessThan(
      field,
    );
  });

  it('no guarded composer hands onCancel straight to a press', () => {
    // Only the files that already hold the guard. `onCancel` elsewhere means something else
    // entirely — `VideoUploadTile`'s aborts an in-flight upload, and there is no draft there to
    // lose. Comment-stripped, because `use-dirty-guard.ts` quotes this rule in prose.
    const guarded = FILES.filter((p) => !isTest(p) && GUARD_CALL.test(stripComments(read(p))));
    expect(
      guarded.length,
      'no file calls the dirty guard at all — this walk is broken, not the tree (#636).',
    ).toBeGreaterThan(5);
    // Whole-file, not per line: prettier wraps a longer prop across lines and `\s*` cannot span
    // a split — the same reason §32 scans the joined source. Both spellings of the bare handoff;
    // an ALIAS (`onPress={handleCancel}` where that is `onCancel`) is out of a regex's reach and
    // is left to review rather than pretended at.
    const BARE = /onPress=\{\s*(?:onCancel|\(\s*\)\s*=>\s*onCancel\s*\(\s*\))\s*\}/g;
    const bare: string[] = [];
    for (const p of guarded) {
      const src = stripComments(read(p));
      for (const m of src.matchAll(BARE)) {
        bare.push(`${rel(p)}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(
      bare,
      'a composer that owns a draft wires onCancel directly to onPress, so the draft goes ' +
        'without a word. Route it through `confirmDiscard({ dirty, saving }, onCancel)` — the ' +
        'clean-draft branch runs it immediately anyway, so the guarded call is never the ' +
        'longer path (#636, #659).',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 34 — the «Aiuta» CTA reads the same rule the picker it opens filters on (#660)
// ---------------------------------------------------------------------------------------

/**
 * #660, *Beyond the issue*. Person Detail derives a tappa's `helpState` from the viewer's prior
 * offers alone (`app/(modal)/user/[id].tsx`) and defaults to `'available'`, so a FINISHED tappa
 * arrived at the row carrying «Aiuta» — beside its own ✓, and absent from the picker that CTA
 * opens, which filters on `helpableMilestones`. A dead-end CTA, on the one surface a `HelpState`
 * cannot describe: the union has no "not helpable" member, and `DreamCard`'s `?? 'available'`
 * would re-manufacture the wrong value even if the derivation withheld it.
 *
 * `MilestoneRow` is the only place holding both the status and the decision, so the fix lives
 * there — which puts it in JSX, where `apps/native` has no render harness and the unit tests on
 * `isHelpableStatus` can only prove the predicate, never that the row consults it. Hence a static
 * guard, the repo's answer for an untestable JSX invariant (§21, §28, §29 are the same shape).
 *
 * It pins the two halves separately: that the gate is spelled with the SHARED predicate rather
 * than a hand-rolled `!done` that would drift from the picker, and that no «Aiuta» renders
 * outside it, IN THIS FILE.
 *
 * ## What it cannot see
 *
 * Scoped to `MilestoneRow.tsx`, so a SECOND «Aiuta» renderer somewhere else is invisible to it.
 * That is safe only because `t('help.cta')` has exactly one call site today — a fact this
 * section does not itself assert, and the thing to re-check before trusting it after a screen
 * grows its own copy of the row.
 *
 * The third assertion bounds the CTA branch by its two ANCHOR TOKENS — `{offerable ? (` and the
 * `) : helpState` that opens its alternative — rather than by balanced delimiters or by a
 * fixed-width lookback. Delimiters are out, because `{t('help.cta', locale)}` carries braces of
 * its own and no brace-counting regex can span the branch it sits in. A fixed window was the
 * first attempt and is worse than it looks: the margin is a distance between two offsets that
 * both move, it shrank rather than grew with the code (deleting the wrapper's
 * `accessibilityLabel` line alone would have eaten 98 of the 99 characters of slack), and a
 * comment stating it had already got the DIRECTION backwards once. Anchors have no margin to
 * erode.
 *
 * What that costs instead: the anchors are spellings. Restructure the branch — a different
 * ternary shape, an extracted variable, a rename of `offerable` — and the span is not found.
 * That fails loudly rather than quietly, which is the trade taken: the find-something test
 * below asserts both anchors resolve, so this section goes red asking to be re-read rather
 * than passing an ungated «Aiuta».
 *
 * "Loudly" is a claim about the search too, not only about the anchors, which is why the span
 * is walked BACKWARDS from the close — see {@link ctaBranch}. Anchored forwards, the one
 * restructure that failed SILENTLY was a further `{offerable ? (` inserted ahead of the chip
 * branch: the span widened past the render it was supposed to bound and the suite stayed
 * green. A false negative sitting quiet is the failure direction §21's own paragraph calls the
 * unacceptable one, so it is closed by construction here rather than described.
 */
describe('the «Aiuta» CTA is gated on the shared helpable rule (#660)', () => {
  const ROW = `${SRC}components/profile/MilestoneRow.tsx`;
  const src = () => stripComments(read(ROW));

  /**
   * The CTA branch, bounded by its opening gate and the token that opens its alternative.
   *
   * The CLOSE is found first and the open is walked BACK from it, because only the close is
   * unique: `{offerable ? (` occurs twice in the row today (the chip branch and the wrapper
   * around it) and a forward `indexOf` would take whichever came first in the file. That is
   * not a hypothetical — a THIRD `{offerable ? (` inserted ahead of the chip branch, with an
   * ungated «Aiuta» in its alternative arm, would widen a forward-anchored span until it
   * swallowed the very render this section exists to catch, and pass. Walking back from the
   * unique close always lands on the gate that actually opens the branch the close belongs to.
   */
  const ctaBranch = (s: string): [number, number] => {
    const close = s.indexOf(') : helpState');
    return [close < 0 ? -1 : s.lastIndexOf('{offerable ? (', close), close];
  };

  it('finds the row, its CTA and the branch it is bounding', () => {
    // A scanner that finds nothing passes both assertions below without checking anything.
    // The path first, §33's shape: a renamed row would otherwise surface as an ENOENT crash
    // out of `read` rather than as this section saying what went wrong.
    expect(
      FILES.includes(ROW),
      'MilestoneRow.tsx has moved — this section is vacuous until the path is fixed (#660).',
    ).toBe(true);
    const s = src();
    expect(
      /t\('help\.cta'/.test(s),
      'no «Aiuta» render in MilestoneRow.tsx — this walk is broken, not the tree',
    ).toBe(true);
    const [open, close] = ctaBranch(s);
    expect(
      open >= 0 && close > open,
      'the CTA branch no longer reads `{offerable ? (` … `) : helpState`, so the span below ' +
        'bounds nothing. The assertion is anchored on those two spellings — restructuring the ' +
        'ternary is fine, but re-anchor it here in the same change (#660).',
    ).toBe(true);
  });

  it('the gate consults help-picker, not a hand-rolled !done', () => {
    // Whitespace-collapsed: prettier wraps both the import and the initializer.
    const s = src().replace(/\s+/g, ' ');
    expect(
      /import \{[^}]*\bisHelpableStatus\b[^}]*\} from '@\/lib\/help-picker'/.test(s),
      'MilestoneRow no longer imports isHelpableStatus. The row and `helpableMilestones` have ' +
        'to answer "is this tappa still helpable?" the same way — two spellings of that rule ' +
        'drift, and the drift renders «Aiuta» on a tappa the picker then refuses to list (#660).',
    ).toBe(true);
    expect(
      /const offerable =[^;]*isHelpableStatus\(status\)/.test(s),
      'the `offerable` gate no longer calls isHelpableStatus(status). Whatever replaced it is ' +
        'a second copy of the picker’s rule.',
    ).toBe(true);
  });

  it('every «Aiuta» render sits inside that branch', () => {
    const s = src();
    const [open, close] = ctaBranch(s);
    const ungated = [...s.matchAll(/t\('help\.cta'/g)]
      .filter(({ index = -1 }) => !(open >= 0 && close > open && index > open && index < close))
      .map((m) => `${rel(ROW)}:${s.slice(0, m.index).split('\n').length}`);
    expect(
      ungated,
      `an «Aiuta» render outside the offerable gate:\n  ${ungated.join('\n  ')}\n` +
        'Every one of them has to sit inside the `{offerable ? (` branch, or the CTA comes back ' +
        'on a done tappa and leads to a picker that will not list it (#660).',
    ).toEqual([]);
  });
});

// 35 — every AutoFill-capable field decides its iOS posture in place (#615, #662)
// ---------------------------------------------------------------------------------------

/**
 * #615 found that re-editing a filled field could replace the whole line, and pinned the cause
 * on iOS AutoFill committing a suggestion (its hypothesis 2). The remedy is a call-site one:
 * `textContentType` is iOS-only and OVERRIDES the value RN derives from `autoComplete`
 * (`TextInput.js` maps one to the other only when the explicit prop is absent), so a field can
 * keep its Android manager and still refuse the iOS fill. #620 applied it to the password field
 * alone; #662 is the residual — `name` and `emailAddress` rode into the signup branch, where the
 * same vector lands.
 *
 * The rule the tree now follows is about what the person is DOING, not about which field it is:
 * a value being CREATED takes `none`, a value being RECALLED keeps the fill. That is a JSX
 * invariant on props no assertion in this app can reach at runtime — `apps/native` has no render
 * harness — so it is a static guard, the same answer as §21, §28, §29.
 *
 * It pins three things:
 *
 *   1. the registry below is the WHOLE set of AutoFill-capable fields, by count. A new field that
 *      asks a platform manager to fill it therefore cannot land without a posture decided here.
 *   2. each registered field carries both spellings — which is what keeps the two props
 *      independent in fact and not just in the comment: dropping `autoComplete` while "cleaning
 *      up" the iOS side would silently take Android's password and contact managers with it.
 *   3. separately from the registry, that no field on `welcome.tsx` asks iOS to fill during
 *      SIGNUP. Stated on its own so that flipping a registry row back to a fill goes red on the
 *      invariant rather than quietly redefining it.
 *
 * ## What it cannot see
 *
 * Not the device behaviour. Whether iOS actually replaces the line is #615's open question, and
 * no static read answers it; this only asserts that the app asks for what it decided to ask for.
 *
 * Nothing about a field that carries NEITHER prop: with both absent, iOS has no content type to
 * commit and Android no manager to offer, so there is no posture to decide. The count in the
 * first assertion is therefore over EITHER prop, because either one ALONE is enough to be
 * filled and the two reach different platforms: RN hands `autoComplete` to the native component
 * on Android only (`TextInput.js:922-926`), while `textContentType` is honoured whenever it is
 * non-null (`:927-937`). A field spelling only `textContentType` is iOS-fillable with no Android
 * manager at all, so counting `autoComplete` sites alone would have let one land unregistered.
 *
 * Two rows on one screen may share an `autoComplete` spelling; they are then matched in FILE
 * order, one tag each. That is why the second assertion claims a tag as it consumes it rather
 * than searching the whole file per row: an unclaimed search would satisfy both rows from the
 * first tag, leaving the second field's posture unchecked while the count still balanced —
 * the one way this section could have passed over exactly the field it exists to pin.
 */
describe('every AutoFill-capable field decides its iOS posture in place (#615, #662)', () => {
  const WELCOME = `${SRC}app/(auth)/welcome.tsx`;

  /**
   * Every field in the app a platform manager can fill, with the two spellings it must carry.
   * Keyed by the `autoComplete` spelling, because two fields on one screen are told apart by it
   * and not by their tag. Whitespace-collapsed at the point of comparison — prettier owns how
   * these wrap.
   */
  const FIELDS = [
    {
      what: 'signup name',
      file: WELCOME,
      autoComplete: `autoComplete="name"`,
      textContentType: `textContentType="none"`,
    },
    {
      what: 'email, both branches',
      file: WELCOME,
      autoComplete: `autoComplete="email"`,
      textContentType: `textContentType={login ? 'emailAddress' : 'none'}`,
    },
    {
      what: 'password, both branches',
      file: WELCOME,
      autoComplete: `autoComplete={login ? 'current-password' : 'new-password'}`,
      textContentType: `textContentType={login ? 'password' : 'none'}`,
    },
    {
      what: 'password reset',
      file: `${SRC}app/(modal)/new-password.tsx`,
      autoComplete: `autoComplete="new-password"`,
      textContentType: `textContentType="none"`,
    },
    {
      what: 'forgotten-password email',
      file: `${SRC}app/(auth)/forgot-password.tsx`,
      autoComplete: `autoComplete="email"`,
      textContentType: `textContentType="emailAddress"`,
    },
    {
      // #782: the @handle is CREATED — at the onboarding step and in the profile editor, one
      // component for both — so neither platform may fill it.
      what: 'handle, chosen or renamed',
      file: `${SRC}components/profile/HandleField.tsx`,
      autoComplete: `autoComplete="off"`,
      textContentType: `textContentType="none"`,
    },
  ];

  const flat = (s: string) => s.replace(/\s+/g, ' ');

  /**
   * Every JSX opening tag in the app tree that asks for an autofill, with its file. EITHER prop
   * counts: one without the other still gets the field filled, on one platform or the other.
   */
  const autofillTags = () =>
    FILES.filter((p) => !isTest(p)).flatMap((p) =>
      jsxOpeningTags(stripComments(read(p)))
        .filter((t) => /(?:autoComplete|textContentType)\s*=/.test(t.raw))
        .map((t) => ({ ...t, path: p })),
    );

  it('finds the fields it is walking', () => {
    // A registry naming files that have moved would pass every assertion below by finding
    // nothing, and `read` would crash out with an ENOENT that says nothing about why.
    const missing = [...new Set(FIELDS.map((f) => f.file))].filter((p) => !FILES.includes(p));
    expect(
      missing.map(rel),
      'a registered AutoFill screen has moved — this section is vacuous until the paths are ' +
        'fixed (#662).',
    ).toEqual([]);
    // The count is the gate on NEW fields: a screen that grows an autofilled input has to
    // decide its iOS posture and register it here, in the same change.
    const found = autofillTags().map((t) => `${rel(t.path)}:${t.line}`);
    expect(
      found.length,
      `the app has ${found.length} autofilled field(s), the registry has ${FIELDS.length}:\n  ` +
        `${found.join('\n  ')}\n` +
        'A new one has to pick an iOS posture — `none` where the person is creating the value, ' +
        'the fill where they are recalling it — and take a row above (#615, #662).',
    ).toBe(FIELDS.length);
  });

  it('every registered field carries both spellings', () => {
    const wrong: string[] = [];
    const pools = new Map<string, ReturnType<typeof jsxOpeningTags>>();
    for (const f of FIELDS) {
      if (!pools.has(f.file)) pools.set(f.file, jsxOpeningTags(stripComments(read(f.file))));
      const pool = pools.get(f.file) as ReturnType<typeof jsxOpeningTags>;
      const tag = pool.find((t) => flat(t.raw).includes(flat(f.autoComplete)));
      if (!tag) {
        wrong.push(`${rel(f.file)}: no field spelled \`${f.autoComplete}\` (${f.what})`);
        continue;
      }
      // Claimed, so a second row with the same spelling reads the NEXT field and not this one.
      pool.splice(pool.indexOf(tag), 1);
      if (!flat(tag.raw).includes(flat(f.textContentType))) {
        wrong.push(
          `${rel(f.file)}:${tag.line} (${f.what}) does not carry \`${f.textContentType}\``,
        );
      }
    }
    expect(
      wrong,
      `an AutoFill posture no longer matches the registry:\n  ${wrong.join('\n  ')}\n` +
        'Both props are load-bearing and independent: `autoComplete` is the whole of Android’s ' +
        'password and contact manager, `textContentType` is the whole of iOS’s. Dropping either ' +
        'to tidy the other is a silent loss (#615, #662).',
    ).toEqual([]);
  });

  it('no field asks iOS to fill during signup', () => {
    const src = stripComments(read(WELCOME));
    const bad = jsxOpeningTags(src)
      .map((t) => ({ t, m: /textContentType=(\{[^}]*\}|"[^"]*")/.exec(flat(t.raw)) }))
      .filter(({ m }) => m)
      .filter(({ m }) => {
        const v = (m as RegExpExecArray)[1] as string;
        // Either off outright, or on only in the sign-in branch with `none` as the other arm.
        return !(v === '"none"' || /^\{login \? '[A-Za-z]+' : 'none'\}$/.test(v));
      })
      .map(({ t, m }) => `${rel(WELCOME)}:${t.line} — ${(m as RegExpExecArray)[1]}`);
    expect(
      bad,
      `a welcome.tsx field asks iOS for an AutoFill value in the signup branch:\n  ` +
        `${bad.join('\n  ')}\n` +
        'Signing up, the person is typing a value that does not exist yet, and a committed ' +
        'suggestion replaces the whole line on re-focus (#615 hypothesis 2). Every field on this ' +
        'screen is `"none"`, or `{login ? <type> : \'none\'}` where the sign-in branch recalls a ' +
        'value that does exist (#662).',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 36 — a focused field is revealed, not merely uncovered (#689)
// ---------------------------------------------------------------------------------------

/**
 * #614 stopped the keyboard covering the viewport: `KeyboardAvoiding` pads the wrapper by the
 * keyboard's height and the content region shrinks. It moves nothing INSIDE that region, so on
 * the device walk the signup password field — last in the column — was still off screen after
 * the lift, reachable only by scrolling. #689 is the other half: `hooks/use-reveal-on-focus.ts`
 * scrolls the focused row into the shrunken viewport.
 *
 * Three things a call site can get silently wrong, so three assertions:
 *
 *   1. the props never land at all — the screen imports the hook and forgets to spread
 *      `scrollProps`, or grows a field that has no `fieldProps`. The field count is the gate:
 *      every field on a registered screen — `Input` and `Field`, the app's two field
 *      primitives — carries the reveal, so a new one cannot land without deciding to. The list
 *      tag is checked for a SECOND SPELLING of what the spread already supplies: an `onScroll`
 *      or a `ref` written on the tag as well as arriving through the spread leaves which one
 *      survives to source order, and if it is not the reveal's the list stops being tracked
 *      silently. Position is not read — a prop written before the spread would lose rather than
 *      win, and is flagged too. Over-reporting on purpose, the stance `jsxOpeningTags` takes:
 *      one tag carrying both spellings is worth a second look either way round.
 *   2. the row ref and the focus handler are given DIFFERENT keys. Nothing throws — the reveal
 *      measures a row that was never registered and returns — so the two key sets are compared
 *      rather than counted.
 *   3. a second mechanism appears beside it. `measureLayout` is the reveal's whole coupling to
 *      layout, and it belongs in one file for the same reason `Keyboard.addListener` does (§8):
 *      two answers to "where is this field" drift apart.
 *
 * ## What it cannot see
 *
 * The device behaviour. `react-native-web`'s `Keyboard` is a stub — `isVisible()` is false and
 * `addListener` returns a no-op — so the inset is 0 in the browser harness, the viewport never
 * shrinks, and the reveal has nothing to do there. The arithmetic and the sequencing are tested
 * at a boundary instead (`lib/reveal-on-focus.test.ts`, node); that an iPhone actually lands the
 * field above the keyboard is a device claim and stays one.
 *
 * Not the composers, deliberately. The registry is the FORM screens — several fields stacked
 * down a scroll, where focusing one says nothing about where the others sit — not `chat`,
 * `post-compose`, `story-compose`, `candidacy` or `ProfileEditForm`, whose one
 * field IS the screen and which the wrapper's lift already clears. `(onboarding)` left that list
 * in #754: its steps are top-anchored now, and the lift had only cleared the dream field while
 * the step was centred in the shrinking viewport. `project-compose` is named
 * like a composer and shaped like a form — a title field, a chip row, then a tall description at
 * the foot — so it is in.
 *
 * ## The CTA is part of the reveal (#752, #766)
 *
 * A field landed above the keyboard with its only button still under it is a form nobody can
 * send, so every registered form says where its CTA goes — carried up with the focused row
 * (`SUBMITS`), or pinned below the list where the keyboard cannot reach it (`PINNED`) — and a
 * form that says neither fails. Two more things decide whether the member can actually press
 * it: `keyboardShouldPersistTaps="handled"` on the list, without which the first tap on a
 * control the reveal just brought up only dismisses the keyboard (RN's default, `never`, eats
 * it); and, where the last field is single-line, a return key that submits through the CTA's
 * own gate (`KEY_SUBMITS`).
 */
describe('a focused field is revealed, not merely uncovered (#689)', () => {
  /** The form screens that wire the reveal, with the key each of their fields is filed under. */
  const FORMS = [
    { file: `${SRC}app/(auth)/welcome.tsx`, keys: ['name', 'email', 'password'] },
    { file: `${SRC}app/(auth)/forgot-password.tsx`, keys: ['email'] },
    { file: `${SRC}app/(modal)/new-password.tsx`, keys: ['password'] },
    // #908 (2026-10-01): App Review could not finish the deletion flow. One field, but it is the
    // last thing above the CTA on a long column — the form shape, not the composer shape.
    { file: `${SRC}app/(modal)/delete-account.tsx`, keys: ['confirm'] },
    {
      file: `${SRC}app/(modal)/event-create.tsx`,
      keys: ['name', 'desc', 'streamUrl', 'venue', 'city', 'capacity', 'price'],
    },
    { file: `${SRC}app/(modal)/project-compose.tsx`, keys: ['title', 'description'] },
    { file: `${SRC}app/(onboarding)/index.tsx`, keys: ['birth', 'dream'] },
  ];

  /** The app's two field primitives. Either one on a registered screen owes a reveal. */
  const FIELDS = ['Input', 'Field'];

  /**
   * The forms whose CTA rides along with the focused row (#752). Revealing the row alone landed
   * the password field and left «Accedi» under the keyboard, and nothing but a device can see
   * that happen again — the browser harness has no keyboard to cover anything.
   */
  const SUBMITS = [
    `${SRC}app/(auth)/welcome.tsx`,
    `${SRC}app/(auth)/forgot-password.tsx`,
    `${SRC}app/(modal)/new-password.tsx`,
    `${SRC}app/(modal)/delete-account.tsx`,
    `${SRC}app/(modal)/event-create.tsx`,
    `${SRC}app/(onboarding)/index.tsx`,
  ];

  /**
   * The screens whose CTA is pinned BELOW the list instead, where no ride-along can keep it
   * (#766). `project-compose` ends on a tall multiline description whose return key types a
   * newline: once the text grows past what fits beside the button, `revealSpan` drops the CTA
   * and nothing on the keyboard can send. Pinned the way the two composers pin theirs (#748),
   * which are named here too — nothing guarded their bars before. Each names its CTA by the
   * handler it presses, so "the CTA" is never just whichever `Button` happens to come last.
   */
  const PINNED = [
    { file: `${SRC}app/(modal)/project-compose.tsx`, onPress: 'onPublish' },
    { file: `${SRC}app/(modal)/post-compose.tsx`, onPress: 'onPublish' },
    { file: `${SRC}app/(modal)/story-compose.tsx`, onPress: 'onPublish' },
  ];
  const PINNED_FILES = PINNED.map((p) => p.file);

  /**
   * The forms whose last field is single-line and submits from the return key (#752). Not
   * `event-create`: its last fields are number pads, and iOS draws no return key on those.
   */
  const KEY_SUBMITS = [
    `${SRC}app/(auth)/welcome.tsx`,
    `${SRC}app/(auth)/forgot-password.tsx`,
    `${SRC}app/(modal)/new-password.tsx`,
  ];

  const SEAM = 'lib/reveal-on-focus.ts';

  /** Keys quoted at a `.rowRef('…')` / `.fieldProps('…')` call, receiver-agnostic. */
  const keysOf = (src: string, method: 'rowRef' | 'fieldProps') =>
    [...src.matchAll(new RegExp(`\\.${method}\\('([^']+)'\\)`, 'g'))]
      .map((m) => m[1] as string)
      .sort();

  it('finds the screens it is walking', () => {
    // A registry naming a moved file would pass everything below by finding nothing.
    const missing = [
      ...FORMS.map((f) => f.file),
      ...SUBMITS,
      ...PINNED_FILES,
      ...KEY_SUBMITS,
    ].filter((p) => !FILES.includes(p));
    expect(
      [...new Set(missing)].map(rel),
      'a registered form screen has moved — this section is vacuous until the paths are fixed.',
    ).toEqual([]);
  });

  it('every registered form wires the list, and every field on it asks for the reveal', () => {
    const wrong: string[] = [];
    for (const form of FORMS) {
      const src = stripComments(read(form.file));
      const where = rel(form.file).replace('apps/native/src/', '');
      if (!src.includes('useRevealOnFocus')) wrong.push(`${where}: does not call useRevealOnFocus`);
      if (!src.includes('KeyboardAvoiding')) {
        wrong.push(`${where}: the reveal is half a pair — the wrapper is the other half`);
      }
      const tags = jsxOpeningTags(src);
      const lists = tags.filter((t) => t.base === 'ScrollView');
      const spread = lists.filter((t) => /\.\.\.[A-Za-z_$][\w$]*\.scrollProps/.test(t.raw));
      if (spread.length === 0) {
        wrong.push(`${where}: its ScrollView does not spread the reveal's scrollProps`);
      }
      for (const one of spread) {
        const clash = /\b(onScroll|onLayout|onContentSizeChange|ref)=/.exec(one.raw);
        if (clash) {
          wrong.push(`${where}:${one.line} re-declares \`${clash[1] as string}\` after the spread`);
        }
      }
      const fields = tags.filter((t) => FIELDS.includes(t.base));
      const revealed = fields.filter((t) => /\.fieldProps\('/.test(t.raw));
      if (fields.length !== revealed.length) {
        wrong.push(
          `${where}: ${fields.length} field(s), ${revealed.length} with a reveal — ` +
            `unrevealed at line(s) ${fields
              .filter((t) => !/\.fieldProps\('/.test(t.raw))
              .map((t) => t.line)
              .join(', ')}`,
        );
      }
    }
    expect(
      wrong,
      `a form screen no longer reveals the field the member tapped:\n  ${wrong.join('\n  ')}\n` +
        'KeyboardAvoiding uncovers the viewport; it moves nothing into it. A field added to one ' +
        'of these screens takes a row ref and a fieldProps spread under the same key (#689).',
    ).toEqual([]);
  });

  it('the row ref and the focus handler agree on every key', () => {
    const wrong: string[] = [];
    for (const form of FORMS) {
      const src = stripComments(read(form.file));
      const where = rel(form.file).replace('apps/native/src/', '');
      const rows = keysOf(src, 'rowRef');
      const focus = keysOf(src, 'fieldProps');
      const expected = [...form.keys].sort();
      if (rows.join() !== focus.join()) {
        wrong.push(
          `${where}: rowRef ${JSON.stringify(rows)} vs fieldProps ${JSON.stringify(focus)}`,
        );
      } else if (rows.join() !== expected.join()) {
        wrong.push(
          `${where}: wires ${JSON.stringify(rows)}, registry says ${JSON.stringify(expected)}`,
        );
      }
    }
    expect(
      wrong,
      `a reveal key is spelled two ways, or the registry is stale:\n  ${wrong.join('\n  ')}\n` +
        'A key that matches nothing fails SILENTLY — the reveal measures a row it was never ' +
        'given and returns, so the field stays under the keyboard with nothing to see (#689).',
    ).toEqual([]);
  });

  it('the registered forms bring their submit along with the focused row', () => {
    const wrong = SUBMITS.filter(
      (p) =>
        !FILES.includes(p) ||
        !/\bref=\{[A-Za-z_$][\w$]*\.submitRef\(\)\}/.test(stripComments(read(p))),
    ).map((p) => rel(p).replace('apps/native/src/', ''));
    expect(
      wrong,
      `a form no longer hands its CTA to the reveal:\n  ${wrong.join('\n  ')}\n` +
        'Without `ref={reveal.submitRef()}` on the CTA block the reveal lands the field and ' +
        'leaves the only button under the keyboard — #752, on a screen nothing but a device can ' +
        'check. A moved file fails here too.',
    ).toEqual([]);
  });

  it('every registered form says where its CTA goes', () => {
    // Exactly one of the two: neither leaves the button wherever the scroll happens to put it,
    // and both is a ref on a bar outside the list, measured against a list it is not in.
    const wrong = FORMS.map((f) => f.file)
      .filter((p) => SUBMITS.includes(p) === PINNED_FILES.includes(p))
      .map((p) => rel(p).replace('apps/native/src/', ''));
    expect(
      wrong,
      `a form's CTA is in neither SUBMITS nor PINNED, or in both:\n  ${wrong.join('\n  ')}\n` +
        'Revealing the field is half the job — a CTA left under the keyboard is a form nobody ' +
        'can send (#766). Hand the CTA block to `reveal.submitRef()`, or pin it below the list.',
    ).toEqual([]);
  });

  it('a pinned CTA sits below the list, inside the keyboard lift', () => {
    const wrong: string[] = [];
    for (const { file, onPress } of PINNED) {
      const src = stripComments(read(file));
      const where = rel(file).replace('apps/native/src/', '');
      const lineOf = (i: number) => (i === -1 ? -1 : src.slice(0, i).split('\n').length);
      const listEnd = lineOf(src.lastIndexOf('</ScrollView>'));
      const liftEnd = lineOf(src.lastIndexOf('</KeyboardAvoiding>'));
      const ctas = jsxOpeningTags(src).filter(
        (t) => t.base === 'Button' && t.raw.includes(`onPress={${onPress}}`),
      );
      if (ctas.length !== 1) {
        wrong.push(`${where}: ${ctas.length} Buttons press \`${onPress}\`, expected exactly one`);
        continue;
      }
      const cta = ctas[0] as { line: number };
      if (listEnd === -1 || cta.line < listEnd) {
        wrong.push(`${where}:${cta.line} is inside the list`);
      } else if (liftEnd === -1 || cta.line > liftEnd) {
        wrong.push(`${where}:${cta.line} is outside KeyboardAvoiding — the keyboard covers it`);
      }
      // A ride-along ref on a pinned bar measures it against a list it is not in.
      if (/\.submitRef\(\)/.test(src)) wrong.push(`${where}: pinned AND hands a submitRef`);
    }
    expect(
      wrong,
      `a pinned CTA moved back into the scroll, or out of the lift:\n  ${wrong.join('\n  ')}\n` +
        'Inside the ScrollView the wrapper shrinks the list around the button and it stays under ' +
        'the keyboard (#748, #766); outside `KeyboardAvoiding` nothing lifts it at all — and a ' +
        '`Screen footer` is the bar DESIGN §6 says the wrapper does NOT lift, so it is no ' +
        'substitute here.',
    ).toEqual([]);
  });

  it('the first tap on these lists lands on the control', () => {
    const wrong: string[] = [];
    for (const p of new Set([...FORMS.map((f) => f.file), ...PINNED_FILES])) {
      const src = stripComments(read(p));
      const where = rel(p).replace('apps/native/src/', '');
      for (const list of jsxOpeningTags(src).filter((t) => t.base === 'ScrollView')) {
        if (!/\bkeyboardShouldPersistTaps="handled"/.test(list.raw)) {
          wrong.push(`${where}:${list.line}`);
        }
      }
    }
    expect(
      wrong,
      `a list with the keyboard up swallows the first tap:\n  ${wrong.join('\n  ')}\n` +
        "RN's default (`never`) spends the first tap on a control dismissing the keyboard, so the " +
        'CTA the reveal just brought up needs a second press. `keyboardShouldPersistTaps=' +
        '"handled"` (#748, #766).',
    ).toEqual([]);
  });

  it('a single-line last field submits from the return key, through the CTA gate', () => {
    const wrong: string[] = [];
    for (const p of KEY_SUBMITS) {
      const src = stripComments(read(p));
      const where = rel(p).replace('apps/native/src/', '');
      const tags = jsxOpeningTags(src);
      // The key is a second way to press the CTA, so it must ask the CTA's own question: a
      // `submit` that does not re-check is reachable mid-flight or with a malformed field (#752).
      if (
        !/const submitFromKeyboard = \(\) => \{ if \(!disabled\) void submit\(\); \};/.test(
          src.replace(/\s+/g, ' '),
        )
      ) {
        wrong.push(`${where}: submitFromKeyboard does not go through \`disabled\``);
      }
      if (!tags.some((t) => t.base === 'Button' && /\bdisabled=\{disabled\}/.test(t.raw))) {
        wrong.push(`${where}: no Button is gated by the same \`disabled\``);
      }
      const keys = tags.filter((t) => /\bonSubmitEditing=\{submitFromKeyboard\}/.test(t.raw));
      if (keys.length === 0) wrong.push(`${where}: no field submits from the return key`);
      for (const key of keys.filter((t) => !/\breturnKeyType="(?:go|send)"/.test(t.raw))) {
        wrong.push(`${where}:${key.line} submits from a return key that does not say so`);
      }
    }
    expect(
      wrong,
      `a form's return key no longer sends it:\n  ${wrong.join('\n  ')}\n` +
        'On a form whose last field is single-line the return key is the one control the ' +
        'keyboard never covers (#752, #766).',
    ).toEqual([]);
  });

  it('only the reveal seam measures a row against its list', () => {
    const users = FILES.filter((p) => !isTest(p))
      .filter((p) => stripComments(read(p)).includes('measureLayout('))
      .map((p) => rel(p).replace('apps/native/src/', ''))
      .sort();
    expect(
      users,
      'measureLayout is the reveal’s whole coupling to layout and belongs in one file, the ' +
        'same reason keyboard events do (§8). A second answer to "where is this field" ' +
        'drifts from the first (#689).',
    ).toEqual([SEAM]);
  });
});

// ---------------------------------------------------------------------------------------
// 37 — the one private expo path, named and bounded (#508)
// ---------------------------------------------------------------------------------------

/**
 * `lib/oauth.ts` reaches into `expo-auth-session/build/QueryParams` — a compiled path, not a
 * public export. It is the only deep import into a `build/` directory in the app, and it exists
 * because `expo-auth-session` does not re-export `QueryParams` from its index (still true on
 * SDK 57, `build/index.d.ts`, checked 2026-09-05) and ships no `exports` map, which is the only
 * reason the path resolves at all.
 *
 * The failure mode is silent: an `exports` map added upstream turns this into a Metro resolution
 * error at bundle time, which is loud; a rename inside `build/` turns `getQueryParams` into
 * `undefined` at the OAuth CALLBACK, on device, with no type error. The second assertion is what
 * stands between that rename and a dead sign-in. The public replacement is `expo-linking`'s
 * `parse(url).queryParams` (already imported in `oauth.ts`); moving to it changes the
 * `errorCode` shape and is its own change, not a reflex.
 */
describe('the expo-auth-session deep import stays deliberate', () => {
  const DEEP = 'expo-auth-session/build/QueryParams';

  it('is used in exactly one file, and it is oauth.ts', () => {
    const users = [
      ...new Set(
        codeLines()
          .filter(([, text]) => text.includes(DEEP))
          .map(([at]) => at.replace('apps/native/src/', '').replace(/:\d+$/, '')),
      ),
    ].sort();
    expect(
      users,
      `${DEEP} is a PRIVATE path — expo-auth-session does not export QueryParams from its ` +
        'index and ships no `exports` map. One site, so the day it stops resolving there is one ' +
        'file to fix (#508).',
    ).toEqual(['lib/oauth.ts']);
  });

  it('the private path still resolves and still exports getQueryParams', () => {
    const req = createRequire(`${SRC}package.json`);
    expect(
      () => req.resolve(DEEP),
      'expo-auth-session moved or gated build/QueryParams. Check whether the SDK now exports ' +
        'QueryParams publicly; if not, `parse(url).queryParams` from expo-linking is the public ' +
        'replacement — oauth.ts already imports expo-linking.',
    ).not.toThrow();
    const mod = req(req.resolve(DEEP)) as { getQueryParams?: unknown };
    expect(
      typeof mod.getQueryParams,
      'build/QueryParams resolves but no longer exports getQueryParams — oauth.ts would read ' +
        '`undefined` at the OAuth callback with no type error.',
    ).toBe('function');
  });
});

// ---------------------------------------------------------------------------------------
// 38 — a third-party brand mark appears on its own provider's CTA and nowhere else (#539)
// ---------------------------------------------------------------------------------------

/**
 * DESIGN §6's carve-out is two clauses, and only the first one is self-enforcing. "A vendor's
 * mark ships unmodified" is held by `provider-marks-mirror.test.ts`. "…and appears ONLY on that
 * provider's OAuth CTA" is held by nothing at all — a Google "G" pasted onto a settings row or
 * an empty state type-checks, lints, renders, and quietly turns an attribution into an icon.
 * That is the failure this section exists for.
 *
 * It passes the test §28's docstring sets for a guard of this shape — "a guard whose allowlist
 * would be longer than its findings is a pin on today's tree, not an invariant". Here the
 * allowlist is one file (`(auth)/welcome.tsx`) against a findings set that is every future
 * import, and the rule it encodes does not expire: a second OAuth provider is still a mark on
 * its own CTA, on this same screen.
 *
 * The scan is on the IMPORT rather than the component name, because a mark reached through an
 * alias or a re-export is the same violation. It matches the module's PATH SUFFIX, not the `@/`
 * specifier: `import { GoogleMark } from './provider-marks'` from a sibling in `components/`
 * contains no `@/…`, and would have walked straight past a specifier match — the guard staying
 * green over exactly the violation it is written for. Nothing in `eslint.config.js` (bare
 * `eslint-config-expo`) forbids the relative form, so this cannot lean on convention.
 *
 * Test files are excluded, so a future `provider-marks.test.tsx` is not a violation — the rule
 * is about what the app RENDERS, and a guard that punished unit-testing the component would be
 * working against itself. `apps/web` is out of scope by having no OAuth CTA at all — there is no
 * `signInWithOAuth` outside `apps/native` — so nothing over there needs a matching guard.
 */
describe('provider brand marks live only on the provider CTAs (#539)', () => {
  // The closing quote anchors the end of the specifier; the leading slash lets `@/components/…`
  // and `./provider-marks` match the same way; the optional extension covers
  // `'…/provider-marks.tsx'`, which resolves just as well and would otherwise slip past. Either
  // quote character, so this does not silently depend on `.prettierrc`'s `singleQuote`.
  const MODULE = /\/provider-marks(\.tsx)?['"]/;

  it('is imported by exactly one file, and it is the welcome screen', () => {
    const importers = [
      ...new Set(
        codeLines()
          .filter(([at, text]) => MODULE.test(text) && !/\.test\.tsx?:\d+$/.test(at))
          .map(([at]) => at.replace('apps/native/src/', '').replace(/:\d+$/, '')),
      ),
    ]
      .filter((p) => p !== 'components/provider-marks.tsx')
      .sort();
    expect(
      importers,
      "components/provider-marks.tsx holds THIRD-PARTY marks. DESIGN §6's carve-out exempts " +
        'them from the 20-glyph ' +
        "icon rule only as attribution on their own provider's OAuth CTA — a vendor mark used " +
        'as decoration anywhere else is a trademark problem, not a style one. Athanor surfaces ' +
        'take a glyph from `components/glyphs.tsx`.',
    ).toEqual(['app/(auth)/welcome.tsx']);
  });

  it('the welcome screen asks for a mark on each provider CTA', () => {
    // The other direction: dropping `icon={providerMark(…)}` would leave the guard above green
    // over a screen that renders no mark at all, which is #539 silently un-shipping itself.
    const screen = stripComments(read(`${SRC}app/(auth)/welcome.tsx`));
    for (const provider of ['apple', 'google']) {
      expect(
        screen.includes(`icon={providerMark('${provider}')}`),
        `the ${provider} CTA on welcome.tsx no longer passes its brand mark (#539).`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------
// 39 — the profile editor's way out is PINNED, and the two scroll axes never nest (#720)
// ---------------------------------------------------------------------------------------

/**
 * #659 put an «Annulla» at the head of the profile editor and §33 pins it there — but the head
 * of ELEVEN sections is still a place you scroll away from, so the control that exists to cost
 * one tap went back to costing a full scroll the moment a member moved. #720 pins it: the form
 * took ownership of the scroll container it used to borrow from `(tabs)/profile.tsx`, and the
 * row is that container's sticky child.
 *
 * §33 cannot see any of this, and the reason is worth stating: it asserts POSITION IN SOURCE
 * ORDER — `<Pressable` and `confirmDiscard(` both appear before the first `<Section>`. Every one
 * of its assertions stays green with the `ScrollView` deleted, with `stickyHeaderIndices` gone,
 * with the row rendered under a condition, or with the fill stripped off it. Source order is not
 * the same claim as "index 0 of a sticky list", and the difference is the whole of #720.
 *
 * Four things are pinned here, each of which fails silently on its own:
 *
 * 1. **The editor owns exactly one `ScrollView`, and it is sticky at [0].** Exactly one, because
 *    `[0]` is meaningless without knowing which view it indexes — a second one would make this
 *    section's other assertions ambiguous rather than wrong, which is worse.
 * 2. **Nothing renders between that `ScrollView` and the row.** This is the real content of
 *    "index 0", and there are two ways to break it, which fail differently.
 *
 *    An EXTRA child above the row — `{banner}`, a header, `{tailSlot}` moved up — takes index 0
 *    whenever it renders, and the row is simply not pinned. That happens on both platforms and
 *    the expo-web walk would catch it. What makes it worth a guard anyway is how quiet it is:
 *    the form still scrolls, «Annulla» still works, it just stops sticking, and nothing errors.
 *
 *    The row made CONDITIONAL is the device-only one, and it is the reason this section names
 *    the platforms at all. React Native reads children through `React.Children.toArray`, which
 *    DROPS `null` and `false`, so on the renders where the row is absent the next child slides
 *    into index 0 and the photo section pins itself. react-native-web uses `React.Children.map`
 *    and keeps the empty slot, so the pin merely goes missing there — the expo-web walk sees
 *    nothing wrong, and the defect is real only on a phone.
 * 3. **The row carries an opaque fill.** Both platforms wrap a sticky child in a transparent box
 *    of their own, so without `bg-background` on the row the form scrolls visibly THROUGH the
 *    pinned control. Renders, lints, type-checks; just looks broken.
 * 4. **`keyboardShouldPersistTaps="handled"` survived the move.** The prop was on the tab's
 *    `ScrollView`; a move that drops it means the first tap on the pinned «Annulla» with the
 *    keyboard up only dismisses the keyboard — a control that visibly does nothing, which is
 *    exactly the complaint #720 was filed about.
 *
 * Plus the invariant on the other side of the move: `(tabs)/profile.tsx` must CLOSE its own
 * `ScrollView` before it mounts the editor. Nesting them is DESIGN §6's «one scroll axis per
 * screen» broken, and a nested pair does not throw — it scrolls, badly, in two places.
 *
 * Text-level, like every section here. It does not prove the row RENDERS pinned; that needs a
 * browser, and PR #720's expo-web walk is where it was proved once. What this stops is the
 * silent regression afterwards.
 */
describe('the profile editor pins its way out, and no screen nests two scroll axes (#720)', () => {
  const EDITOR = `${SRC}components/profile/ProfileEditForm.tsx`;
  const TAB = `${SRC}app/(tabs)/profile.tsx`;

  it('finds both files it is walking', () => {
    for (const p of [EDITOR, TAB]) {
      expect(
        FILES.includes(p),
        `${rel(p)} has moved — this section is vacuous until the path is fixed (#720).`,
      ).toBe(true);
    }
  });

  it('the editor scrolls in exactly one ScrollView, sticky at index 0', () => {
    const code = stripComments(read(EDITOR));
    const opens = code.match(/<ScrollView\b/g) ?? [];
    expect(
      opens.length,
      'ProfileEditForm should own exactly ONE ScrollView (#720). Two make the sticky index ' +
        'below ambiguous: `stickyHeaderIndices={[0]}` names a child of one particular view, ' +
        'and this section can no longer say which.',
    ).toBe(1);
    expect(
      /stickyHeaderIndices=\{\[0\]\}/.test(code),
      'the profile editor no longer pins its «Annulla» (#720). The row is at the head of ' +
        'eleven sections, so without `stickyHeaderIndices={[0]}` on the ScrollView it scrolls ' +
        'out of reach and the one-tap exit #659 shipped costs a full scroll again.',
    ).toBe(true);
    expect(
      /keyboardShouldPersistTaps="handled"/.test(code),
      'the profile editor\'s ScrollView lost `keyboardShouldPersistTaps="handled"` (#720). ' +
        'It came across from the tab with the rest of the props: without it the first tap on ' +
        'the pinned «Annulla» while a field has focus only dismisses the keyboard, so the ' +
        'control reads as dead exactly when a member is most likely to reach for it.',
    ).toBe(true);
  });

  it('the pinned row is the ScrollView’s first child, and it is opaque', () => {
    const code = stripComments(read(EDITOR));
    // From the end of the opening tag, not its start: the tag's own props contain `{[0]}` and
    // would otherwise be scanned as though they were children.
    const openEnd = code.indexOf('>', code.indexOf('<ScrollView')) + 1;
    const press = code.indexOf('<Pressable', openEnd);
    expect(press, 'no <Pressable> inside the profile editor’s ScrollView (#720).').toBeGreaterThan(
      openEnd,
    );

    // Everything the renderer would count as a child before reaching the row. One tag — the
    // row's own <View> — is the pass; anything else has taken index 0.
    //
    // `openEnd` walks to the first `>` after `<ScrollView`, which is that tag's own close only
    // while none of its props contain one. They do not today. An arrow-function prop
    // (`onScroll={(e) => …}`) would break that assumption — but loudly: it drags the remainder
    // of the tag into `before`, and while the element count below survives it (dragged-in prop
    // text holds no `<Tag`), the expression-child assertion after it does not. Verified by
    // injection, message and all. A false red is the safe direction here; a false green is not
    // available.
    const before = code.slice(openEnd, press);
    const tags = before.match(/<[A-Za-z]/g) ?? [];
    expect(
      tags.length,
      'something now renders between the profile editor’s ScrollView and its «Annulla» row ' +
        `(found ${tags.length} elements where only the row's <View> belongs) (#720).\n` +
        'Index 0 is the pin. Any child above the row takes it, and the only symptom is that ' +
        '«Annulla» quietly stops sticking — the form still scrolls and the control still ' +
        'works, so nothing errors and nothing looks broken until you scroll. Put new content ' +
        'BELOW the row, or move the sticky index with it deliberately.',
    ).toBe(1);

    // The row's own opening tag, from its `<` to the first `>` that closes it.
    const rowStart = before.lastIndexOf('<View');

    // A tag count alone is not the claim. A child written as a bare EXPRESSION — `{tailSlot}`,
    // `{banner}`, `{saved ? … : null}` — contains no `<Tag` and would leave the count at one
    // while taking index 0. This PR introduces `tailSlot` as a movable slot, so that is a live
    // hazard rather than a hypothetical. Nothing but whitespace may precede the row; comments
    // are allowed, because `stripComments` blanks a `{/* … */}` down to its braces.
    expect(
      /^[\s{}]*$/.test(before.slice(0, rowStart)),
      'an expression child now renders between the profile editor’s ScrollView and its ' +
        '«Annulla» row (#720). It carries no `<Tag`, so the element count above cannot see it, ' +
        'but the renderer counts it: it takes index 0 and the row stops being pinned. ' +
        // Collapsed: `stripComments` blanks a JSX comment to its braces around a wall of
        // spaces, which would otherwise bury the offending expression in the message.
        `Found: ${JSON.stringify(before.slice(0, rowStart).replace(/\s+/g, ' ').trim()).slice(0, 160)}`,
    ).toBe(true);
    const rowTag = before.slice(rowStart, before.indexOf('>', rowStart) + 1);
    expect(
      /\bbg-background\b/.test(rowTag),
      'the profile editor’s pinned «Annulla» row has no opaque fill (#720).\n' +
        'Native and react-native-web both wrap a sticky child in a TRANSPARENT box of their ' +
        'own, so the fill has to be on the row itself: without it the eleven sections scroll ' +
        `visibly through the pinned control. Row tag as found: ${rowTag}`,
    ).toBe(true);
  });

  it('the Profilo tab closes its own scroll axis before mounting the editor', () => {
    const code = stripComments(read(TAB));
    const close = code.indexOf('</ScrollView>');
    const editor = code.indexOf('<ProfileEditForm');

    // Exactly one, and the ordering assertion below is only worth anything WITH this. With two,
    // `indexOf` finds the first close tag — view mode's — and it precedes `<ProfileEditForm`
    // however deeply the editor is nested inside the second, so the ordering passes green over
    // exactly the nesting this test is named for.
    expect(
      (code.match(/<ScrollView\b/g) ?? []).length,
      'the Profilo tab should own exactly ONE ScrollView (#720) — view mode’s. A second one ' +
        'is how the editor gets re-nested inside a scroll axis it is meant to replace.',
    ).toBe(1);
    expect(
      close,
      'the Profilo tab has no ScrollView at all — this walk is broken (#720).',
    ).toBeGreaterThan(-1);
    expect(
      editor,
      'the Profilo tab no longer mounts ProfileEditForm — this walk is broken, not the tree.',
    ).toBeGreaterThan(-1);
    expect(
      close,
      'the Profilo tab mounts ProfileEditForm INSIDE its own ScrollView (#720).\n' +
        'The editor brings its own scroll container so that its «Annulla» can be that ' +
        'container’s sticky child; nested inside the tab’s, the pin has an outer axis to slide ' +
        'along and DESIGN §6’s «one scroll axis per screen» is broken. The two are meant to be ' +
        'branch-exclusive — view mode’s ScrollView closed before edit mode is ever mounted.',
    ).toBeLessThan(editor);
  });
});

// ---------------------------------------------------------------------------------------
// 40 — logical inline spacing never reaches a node that drops it (#749)
// ---------------------------------------------------------------------------------------

/**
 * Tailwind 4 compiles `px-*` / `mx-*` (and `ps-`/`pe-`/`ms-`/`me-`) to LOGICAL properties —
 * `padding-inline`, `margin-inline` — which `react-native-css` hands to React Native as the
 * `paddingInlineStart`/`End` aliases. RN resolves those aliases inside its own
 * `updateYogaProps`, so an ordinary `View` takes them fine. Two nodes do not:
 *
 * - **`SafeAreaView`**, and therefore `Screen`. Its Fabric shadow node
 *   (`RNCSafeAreaViewShadowNode::adjustLayoutWithState`) rebuilds the Yoga style from the props'
 *   PHYSICAL edges and writes it back over the resolved one, so the aliases are gone.
 *   `<Screen className="px-8">` rendered edge to edge on an iPhone SE and on the moto g17.
 * - **An Android `TextInput`.** On the moto g17 (2026-09-18, a 3.5px step) a compose field put its text
 *   ~7dp from the border with `px-4` and ~17dp with `pl-4 pr-4`. iOS and the web build honour
 *   both, which is how eleven screens and every text field in the app shipped the logical
 *   spelling through every pass that was not an Android device.
 *
 * The physical pair (`pl-`/`pr-`, `ml-`/`mr-`) renders identically everywhere, so the guard
 * costs nothing on correct code. It reads only the tag's OWN `className` — a `footer={<View
 * className="px-5">}` prop on a `Screen` is a plain View and stays legal — and, for the three
 * primitives that build those class strings out of constants rather than inline, every string
 * literal in the file. Margins ride along on the same code path; an Android `TextInput` margin
 * was not measured, and the physical spelling is the safe side of that unknown.
 */
const LOGICAL_INLINE = /(?<![\w-])-?(?:px|mx|ps|pe|ms|me)-[\w[\].]+/g;
const INLINE_DROPPING_TAGS = new Set(['Screen', 'SafeAreaView', 'TextInput']);
const INLINE_CLASS_BUILDERS = [
  'components/Input.tsx',
  'components/Field.tsx',
  'components/Screen.tsx',
];

/** The raw text of a tag's own `className` value — a quoted string or a braced expression. */
function ownClassName(tag: { attrs: string; raw: string }): string | null {
  const at = tag.attrs.search(/\bclassName\s*=/);
  if (at === -1) return null;
  let i = tag.raw.indexOf('=', at) + 1;
  while (/\s/.test(tag.raw[i] ?? '')) i += 1;
  const open = tag.raw[i];
  if (open === '"' || open === "'") return tag.raw.slice(i + 1, tag.raw.indexOf(open, i + 1));
  if (open !== '{') return null;
  let depth = 0;
  for (let j = i; j < tag.raw.length; j += 1) {
    if (tag.raw[j] === '{') depth += 1;
    else if (tag.raw[j] === '}' && --depth === 0) return tag.raw.slice(i + 1, j);
  }
  return tag.raw.slice(i + 1);
}

describe('logical inline spacing never reaches a node that drops it (#749)', () => {
  const tags = () =>
    FILES.filter((p) => !isTest(p)).flatMap((p) =>
      jsxOpeningTags(stripComments(read(p)))
        .filter(({ base }) => INLINE_DROPPING_TAGS.has(base))
        .map((tag) => ({ at: `${rel(p)}:${tag.line}`, base: tag.base, cls: ownClassName(tag) })),
    );

  it('finds the tags it is walking', () => {
    const seen = new Set(
      tags()
        .filter(({ cls }) => cls != null)
        .map(({ base }) => base),
    );
    expect([...seen].sort(), 'the scan stopped seeing a class-carrying tag').toEqual([
      'SafeAreaView',
      'Screen',
      'TextInput',
    ]);
  });

  it('no Screen, SafeAreaView or TextInput className carries a logical inline class', () => {
    const hits = tags().flatMap(({ at, base, cls }) =>
      [...(cls ?? '').matchAll(LOGICAL_INLINE)].map((m) => `${at}  <${base}> ${m[0]}`),
    );
    expect(
      hits,
      'use the physical pair — `pl-N pr-N` for `px-N`, `ml-N mr-N` for `mx-N` (#749)',
    ).toEqual([]);
  });

  it('the primitives that build those classes from constants spell them physically', () => {
    const hits = INLINE_CLASS_BUILDERS.flatMap((f) => {
      const src = stripComments(read(`${SRC}${f}`));
      return [...src.matchAll(/(['"`])((?:(?!\1)[^\\\n])*)\1/g)].flatMap((lit) =>
        [...(lit[2] as string).matchAll(LOGICAL_INLINE)].map(
          (m) => `apps/native/src/${f}:${src.slice(0, lit.index).split('\n').length}  ${m[0]}`,
        ),
      );
    });
    expect(hits, 'use the physical pair (#749)').toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 41 — the consent notice is shown wherever this screen can create an account (#777)
// ---------------------------------------------------------------------------------------

/**
 * A first sign-in with a provider CREATES the account, and OAuth cannot tell which it is — so the
 * sign-in mode, whose Google button is live for real members, creates accounts too. Until #777
 * the notice rendered under `!login` only, and a store reviewer signing in with Google from
 * «Accedi» joined without seeing the terms they were said to accept. Play's UGC policy asks for
 * exactly that acceptance before anyone can post.
 *
 * #795 widened it: on a 667pt screen the signup notice by «Crea account» sits below the fold, so
 * «Continua con Google» created an account before the notice was ever on screen. Both modes now
 * render one under the provider buttons — each mode's own string — and signup keeps its second
 * one by the CTA, which the email path reaches.
 *
 * A source pin, because no render harness reaches this screen. It cannot see layout — whether the
 * notice is on screen next to the buttons is the device walk's to prove.
 */
describe('the consent notice is shown wherever an account can be created (#777)', () => {
  const screen = () => stripComments(read(`${SRC}app/(auth)/welcome.tsx`));

  it('both modes show a notice inside the provider block, each its own string', () => {
    const src = screen();
    const block = src.slice(src.indexOf('{anyOauth ? ('), src.indexOf("t('auth.orEmail'"));
    expect(
      /<LegalNotice\s+text=\{login \? oauthNotice : t\('auth\.legal\.notice', locale\)\}/.test(
        block,
      ),
      'the provider block no longer renders an unconditional notice — sign-in mode must show ' +
        '`auth.legal.oauthNotice` (#777) and signup mode `auth.legal.notice` (#795), or a first ' +
        'Google sign-in creates an account with no notice on screen.',
    ).toBe(true);
    expect(src).toMatch(/t\('auth\.legal\.oauthNotice', locale/);
  });

  it('the signup mode keeps its notice by the CTA', () => {
    expect(screen()).toMatch(
      /\{!login \? \(\s*<LegalNotice\s+text=\{t\('auth\.legal\.notice', locale\)\}/,
    );
  });
});

// ---------------------------------------------------------------------------------------
// 42 — no emoji-capable character is drawn as an icon (#753)
// ---------------------------------------------------------------------------------------

/**
 * A character is not an icon. ▶ ⏸ ⚙ ⚖ are `Emoji=Yes` with TEXT default presentation: whether
 * they draw as a monochrome glyph, a colour emoji or a «?» box is decided by the platform's font
 * fallback, not by this code — #753 found all three outcomes across the simulator, the phone and
 * the web. 🔒 and 🎧 are worse: `Emoji_Presentation=Yes`, so they are colour emoji everywhere, in
 * a design system whose icons are stroke glyphs in `currentColor` (DESIGN §6). U+FE0E does not
 * rescue either kind reliably — Apple's fonts carry no text form for most default-emoji code
 * points — so the fix is a drawing from `components/glyphs.tsx`, and this pins it.
 *
 * The test is Unicode's own `Emoji` property, not a hand-kept list of the characters #753 found:
 * the next one arrives as a code point nobody listed. ASCII is carved out because `#`, `*` and
 * the digits are `Emoji=Yes` for keycap sequences, and U+FE0F is added because it exists only to
 * force emoji presentation. The app's own text marks — ✦ ✧ ✓ ✕ ◎ ◑ ◓ ○ → ★ — are not
 * emoji-capable and pass on the property, not on an exemption; the first `it` pins that, so a
 * Unicode update that moved one of them would say so here rather than as a mystery failure.
 *
 * Comment-stripped, so the prose that documents a replaced character (this file, the docblocks
 * at each #753 site) is not a hit. Escapes and JSX entities are decoded first (`decoded` below): the
 * escaped spelling renders the same pixel, and would otherwise be the way around this guard.
 * Test files are excluded — the rule is about what the app RENDERS.
 *
 * Catalog values are the other road to the screen and are held in `packages/i18n/src/i18n.test.ts`,
 * beside the catalogs, so this file stays inside `apps/native` and needs no `$TURBO_ROOT$` input.
 */
describe('no emoji-capable character reaches the screen (#753)', () => {
  const EMOJI = /\p{Emoji}|\u{FE0F}/u;
  const emojiCapable = (ch: string) => (ch.codePointAt(0) ?? 0) >= 0x80 && EMOJI.test(ch);

  /**
   * The spellings that render a character without writing it: `\u{…}`, `\uXXXX` and `\xHH`
   * escapes, numeric JSX entities, and the named entities Babel's JSX parser decodes onto an
   * emoji-capable code point. `NAMED` is that parser's whole XHTML table (253 names, frozen since
   * XHTML 1.0) filtered by the same property — the complete set, not a sample. Adjacent surrogate
   * escapes (`\uD83D\uDD12`) rejoin into one code point in the decoded string.
   */
  const NAMED: Record<string, string> = {
    copy: '©',
    reg: '®',
    trade: '™',
    harr: '↔',
    spades: '♠',
    clubs: '♣',
    hearts: '♥',
    diams: '♦',
  };
  const decoded = (text: string) =>
    text
      .replace(
        /\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g,
        (_, a?: string, b?: string, c?: string) =>
          String.fromCodePoint(parseInt(a ?? b ?? c ?? '', 16)),
      )
      .replace(/&#(x[0-9a-fA-F]+|\d+);/g, (_, n: string) =>
        String.fromCodePoint(n.startsWith('x') ? parseInt(n.slice(1), 16) : parseInt(n, 10)),
      )
      .replace(/&([a-zA-Z]+);/g, (whole, name: string) => NAMED[name] ?? whole);

  /**
   * A legitimate emoji-capable character, keyed by `file:line` with the reason. Empty today: every
   * site #753 found had an honest drawing. Keyed by line, like §29 and §30, so an entry can never
   * exempt the NEXT character added to the same file.
   */
  const EMOJI_OK: Record<string, string> = {};

  it('the property draws the line where #753 needs it', () => {
    for (const ch of ['▶', '⏸', '⚙', '⚖', '🔒', '🎧', '©', '↗', '\u{FE0F}']) {
      expect(emojiCapable(ch), `${ch} should be flagged`).toBe(true);
    }
    for (const ch of ['✦', '✧', '✓', '✕', '◎', '◑', '◓', '○', '→', '★', '‹', '·', '«', '…', '—']) {
      expect(emojiCapable(ch), `${ch} is a text mark and must pass`).toBe(false);
    }
    for (const ch of ['0', '9', '#', '*']) {
      expect(emojiCapable(ch), `ASCII ${ch} is Emoji=Yes only for keycaps`).toBe(false);
    }
    expect(
      [
        ...decoded(
          String.raw`'\u25B6' '\u{1F512}' '\uD83C\uDFA7' '\xA9' &#x2699; &#9878; &hearts; &amp;`,
        ),
      ].filter(emojiCapable),
    ).toEqual(['▶', '🔒', '🎧', '©', '⚙', '⚖', '♥']);
  });

  it('no source line outside a comment carries one', () => {
    const hits = FILES.filter((p) => !isTest(p)).flatMap((p) =>
      stripComments(read(p))
        .split('\n')
        .flatMap((text, i) => {
          const at = `${rel(p).replace('apps/native/src/', '')}:${i + 1}`;
          const found = [...decoded(text)].filter(emojiCapable);
          if (found.length === 0 || EMOJI_OK[at] !== undefined) return [];
          const cps = found.map((ch) => `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase()}`);
          return [`${at}  ${found.join(' ')} (${cps.join(' ')})  ${text.trim().slice(0, 80)}`];
        }),
    );
    expect(
      hits,
      'an emoji-capable character in rendered source:\n' +
        "Whether it draws as a glyph, a colour emoji or a «?» box is the platform font's " +
        'decision, not ours (#753). Draw it instead — `components/glyphs.tsx` has Play, Pause, ' +
        'Lock, Scales and the SettingsIcon gear, and a new mark is designed in the same system ' +
        'and recorded in DESIGN §6. Audio is the settled case: it takes the transport mark plus ' +
        "its «Audio · m:ss» text, never a mark of its own (ruling 2026-09-20 — the set's " +
        '`waves` read as a Wi-Fi signal on the device). If the character is genuinely right, ' +
        'add its `file:line` to EMOJI_OK with the reason.',
    ).toEqual([]);
  });
});

describe('the glow surfaces are a named set, and the clock is not one (rule 4, DESIGN.md §8.12)', () => {
  /**
   * `auraGlow()` is the glow rule 4 reserves for moment-grade events, and §8.12 rules the
   * `/annual` clock flat. `CountdownCell` glowed anyway from `30628309` (2026-06-17) until
   * 2026-09-20 — nothing failed, because no render test could have caught it (this file's own
   * `walk()` DOES read `.tsx`; the vitest run collects only `*.test.ts`) and the shape tests in
   * `lib/glow.test.ts` pin what the helper RETURNS, never who calls it. A phone caught it,
   * three months on. This pins the callers, so the next one is a deliberate edit to this list.
   *
   * What it pins is the CALLERS, not «the clock is unglowed»: a raw `boxShadow` or a NativeWind
   * `shadow-*` on a countdown file would evade it. Nothing in `apps/native/src` outside
   * `lib/glow*` uses either today, so the coverage is total by circumstance, not construction.
   *
   * Since Galleria (rule 4, mobile half, 2026-10-03) nothing on mobile glows, so the list only
   * loses files: `components/Button.tsx` left on 2026-10-04 with its `glow` prop,
   * `components/Mandorla.tsx` the same day with its `glowLevel`,
   * `components/profile/MomentFlash.tsx` on 2026-10-05 with the Profilo tab, and each of the rest leaves
   * when its own screens are converted (#921, open as of 2026-10-04).
   */
  const GLOW_SURFACES = [
    'app/(modal)/favor.tsx',
    'components/circle/SubscriptionStatusCard.tsx',
    'components/fund/CandidateCard.tsx',
    'components/fund/FundTicker.tsx',
  ];

  it('is called from exactly these files, and no countdown file is among them', () => {
    const callers = [
      ...new Set(
        codeLines()
          .filter(([, text]) => text.includes('auraGlow('))
          .map(([at]) => at.replace('apps/native/src/', '').replace(/:\d+$/, '')),
      ),
    ]
      // The helper and its own test, named exactly: a `lib/glow*` prefix would also swallow a
      // future `lib/glow-<something>.tsx` that calls it, and swallow it silently.
      .filter((p) => p !== 'lib/glow.ts' && p !== 'lib/glow.test.ts')
      .sort();

    expect(
      callers,
      'Nothing on mobile glows since Galleria (rule 4), so a file that is NEW here is a ' +
        'regression: take the `auraGlow()` call out. A file that is MISSING was converted: drop ' +
        'it from GLOW_SURFACES in the same edit. If a COUNTDOWN file appears, that is DESIGN.md ' +
        '§8.12 being broken again — the clock is flat, and was before Galleria too.',
    ).toEqual(GLOW_SURFACES);
  });
});

// ---------------------------------------------------------------------------------------
// 43 — a Button label never wraps inside a pill that sits beside another (#833)
// ---------------------------------------------------------------------------------------

/**
 * Marco's ruling, 2026-09-23: no button label breaks across lines. DESIGN §10 forbids capping
 * text, so the ROW wraps and the label does not — side-by-side pills go in `ButtonRow`, where
 * each pill sizes to its one-line label and a pill that does not fit drops to the next line.
 *
 * The shape this pins is the one that broke it: `<View className="flex-1"><Button …/></View>`
 * hands the pill a fixed share of the row, whatever its label needs, so «Accetta» beside
 * «Rifiuta» beside «Scrivi» broke mid-word on an iPhone SE (#833). The only in-pill wrap left
 * is a LONE full-width pill whose label is wider than the screen at 2× — and a lone pill has
 * no `flex-1` sibling split to be caught here.
 */
describe('a Button is never handed a fixed share of a row (#833)', () => {
  it('no <Button> sits directly inside a `flex-1` wrapper View', () => {
    const hits = FILES.filter((p) => !isTest(p) && p.endsWith('.tsx')).flatMap((p) => {
      const src = stripComments(read(p));
      // `flex-1` or `flex-[N]` leading the class string, in either quoting, with or without
      // more classes after it, and a JSX comment allowed between the cell and the Button
      // (`stripComments` leaves its braces behind, so an empty `{ }` counts as one).
      const cell =
        /<View\s+className=(?:"|\{['"`])flex-(?:1|\[\d+\])(?:\s[^"'`]*)?(?:"|['"`]\})\s*>\s*(?:\{\s*(?:\/\*[\s\S]*?\*\/)?\s*\}\s*)?<Button\b/g;
      return [...src.matchAll(cell)].map(
        (m) =>
          `${rel(p).replace('apps/native/src/', '')}:${src.slice(0, m.index).split('\n').length}`,
      );
    });
    expect(
      hits,
      'a Button in a `flex-1` cell: the pill gets a fixed share of the row and its label ' +
        'wraps mid-word when that share is short. Put side-by-side Buttons in `ButtonRow` ' +
        '(components/ButtonRow.tsx) — the row wraps, the label never does (DESIGN §10, #833).',
    ).toEqual([]);
  });

  /**
   * The cells of a row are not the same height: a pill is 50pt, a `ghost` link 44pt, and a cell
   * may stack two controls (`ConnectButton` while a request is pending). Measured on an iPhone
   * SE simulator on 2026-10-04: aligned by their tops, a pill's label and a link's sit 3pt
   * apart; centred, a link beside a stacked cell lands 12.5pt below the stack's first control.
   * On the text baseline every first-line label shares one line, whatever its cell holds.
   *
   * That baseline is the LABEL's, so a pill has to keep its label in the layout while it is
   * busy. With the label swapped out for the spinner the cell's baseline fell to the spinner's
   * foot: the row grew 2pt and the link beside it sat 4.5pt lower than beside an idle pill
   * (same simulator, same day). With the label kept, a busy pill and an idle one measured the
   * same on the simulator and on a moto g17: same width, same row, same offset to the link.
   */
  it('ButtonRow lines its cells up on the text baseline', () => {
    const row = stripComments(read(`${SRC}components/ButtonRow.tsx`));
    expect(
      /(?<![\w-])items-baseline(?![\w-])/.test(row),
      'components/ButtonRow.tsx no longer aligns its cells with `items-baseline`. A pill and a ' +
        'text link then stop sharing a line of text, and which of them looks wrong depends on ' +
        'what replaced it (the measurements are in the comment above this test).',
    ).toBe(true);
  });

  it('a busy Button keeps its label in the layout, under the spinner', () => {
    const button = stripComments(read(`${SRC}components/Button.tsx`)).replace(/\s+/g, ' ');
    expect(
      /loading && 'opacity-0'/.test(button),
      'components/Button.tsx no longer hides the label of a busy button in place. Rendering ' +
        'the spinner INSTEAD of the label takes the text baseline out of the cell, so a busy ' +
        'pill in a `ButtonRow` shifts its neighbours, and a pill sized to its label shrinks ' +
        'to the spinner.',
    ).toBe(true);
    expect(
      /<View className="absolute [^"]*">\s*<ActivityIndicator\b/.test(button),
      'the spinner of a busy Button is no longer an absolute overlay: in the flow it sits ' +
        'beside the hidden label and widens the pill.',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------
// 44 — a tag label built from data goes through the shared fallback (#883)
// ---------------------------------------------------------------------------------------

/**
 * A tag key is DATA — `profiles.profession`, `skills`, `identity_tags`, `seeking` are text
 * columns the database does not constrain to the curated lists — so it cannot be typed as a
 * MessageKey. Cast it anyway and `t()` echoes an unknown key back: tino_chef's profile read
 * «tag.profession.Chef» (#883). `tagLabel` in `@athanor/i18n` is the one helper that falls back
 * to the stored value instead, so a template `tag.${…}` key and a local `tagLabel` that
 * shadows the shared one are both the same bug waiting for an off-list value.
 */
describe('a tag label built from data goes through the shared fallback (#883)', () => {
  it('no screen builds a `tag.` key from data or defines its own tagLabel', () => {
    const hits = codeLines()
      .filter(([, t]) => /`tag\.\$\{|`tag\.[a-z]+\.\$\{|\b(?:const|function)\s+tagLabel\b/.test(t))
      .map(([at]) => at.replace('apps/native/src/', ''));
    expect(
      hits,
      "a tag key built from data and handed to t(): an off-list value renders as the raw key. Use tagLabel(kind, tag, locale) from '@athanor/i18n', which falls back to the stored value (#883).",
    ).toEqual([]);
  });
});

/**
 * An avatar inside a row that already names the member is decorative (#884). `Avatar` labels
 * itself with the member's name, so inside an unlabelled row iOS joined that label with the name
 * `Text` beside it — «Sole Marini, Sole Marini, 2g, …» — and on Android a focusable disc inside a
 * focusable row was a second TalkBack stop saying the name again.
 *
 * Labelled stays `Avatar`'s default, because forgetting the flag costs a repeated name and the
 * opposite default would cost a missing one. What this section adds is that no call site gets the
 * default by accident: every file that renders an `<Avatar` is registered here with its decision,
 * so the next row is written knowing the question exists. A `decorative` site must be one whose
 * row speaks the name some other way — the row's own label, or the name as adjacent text.
 */
describe('an avatar in a row that names the member stays silent (#884)', () => {
  const AVATAR_SITES: Record<string, { decorative: boolean; why: string }> = {
    'components/chat/ConversationRow.tsx': { decorative: true, why: 'name Text in the row' },
    'components/momenti/SuggestionRow.tsx': { decorative: true, why: 'row label' },
    'components/connections/ConnectionRequestRow.tsx': { decorative: true, why: 'row label' },
    'components/connections/ConnectionRow.tsx': { decorative: true, why: 'row label' },
    'components/feed/PostAuthorRow.tsx': { decorative: true, why: 'row label, or the name Text' },
    'components/costellazioni/FavorRow.tsx': { decorative: true, why: 'row label' },
    'components/costellazioni/ProjectCard.tsx': {
      decorative: true,
      why: 'row label, or the name Text',
    },
    'components/profile/IncomingOfferRow.tsx': { decorative: true, why: 'row label' },
    'components/live/AttendeeStack.tsx': { decorative: true, why: 'row label' },
    'components/chat/Bubble.tsx': { decorative: true, why: 'the avatar button’s label' },
    'components/stories/StoryRing.tsx': { decorative: true, why: 'row label' },
    'components/search/ResultRow.tsx': { decorative: true, why: 'searchRowLabel says the name' },
    'components/trust/BlockedRow.tsx': { decorative: true, why: 'name Text beside it' },
    'app/(modal)/settings.tsx': { decorative: true, why: 'name Text beside it' },
    'components/momenti/MomentoCard.tsx': { decorative: true, why: 'name Text beside it' },
    'app/(modal)/chat.tsx': { decorative: true, why: 'the header title, or the identity label' },
    'components/profile/ProfileHero.tsx': { decorative: false, why: 'the profile’s own face' },
    'components/profile/ProfileEditForm.tsx': { decorative: false, why: 'whose photo this is' },
    'components/home/MomentiCard.tsx': { decorative: true, why: 'name Text beside it' },
    // The row label is generic («Qualcuno ha bisogno di una mano»), so the disc is the only
    // thing naming them.
    'components/home/FavorNudgeCard.tsx': { decorative: false, why: 'generic row label' },
  };

  const sites = FILES.filter((p) => !isTest(p)).flatMap((p) =>
    openingTags(stripComments(read(p)), 'Avatar').map(({ line, attrs }) => ({
      file: rel(p).replace('apps/native/src/', ''),
      line,
      // Bare or `={true}` only: `decorative={false}` is a labelled site written out.
      decorative: /(^|\s)decorative(?=[\s/>]|$|=\{true\})/.test(attrs),
    })),
  );

  it('finds the Avatar sites it is walking', () => {
    // A scanner that finds nothing passes every assertion below.
    expect(sites.length, 'no <Avatar> found at all — the walk is broken').toBeGreaterThan(10);
  });

  it('every Avatar site made the decision its file registers', () => {
    const wrong = sites
      .filter((s) => s.file in AVATAR_SITES)
      .filter((s) => s.decorative !== AVATAR_SITES[s.file]?.decorative)
      .map(
        (s) =>
          `${s.file}:${s.line} (registered ${AVATAR_SITES[s.file]?.decorative ? 'decorative' : 'labelled'})`,
      );
    expect(
      wrong,
      `an <Avatar> that disagrees with its entry in AVATAR_SITES. If the row names the member, ` +
        `pass \`decorative\`; if the disc is the only thing that says who this is, leave it ` +
        `labelled — then update the register to match (#884).`,
    ).toEqual([]);
  });

  it('the register is exactly the files that render an Avatar', () => {
    const owners = [...new Set(sites.map((s) => s.file))].sort();
    expect(
      owners,
      `a file renders <Avatar> without an AVATAR_SITES entry, or an entry no longer renders one. ` +
        `A new row decides here whether its avatar is decorative (#884).`,
    ).toEqual(Object.keys(AVATAR_SITES).sort());
  });
});

// ---------------------------------------------------------------------------------------
// 45 — nothing of ours stands in front of an OS permission prompt (#908)
// ---------------------------------------------------------------------------------------

/**
 * App Review rejected build 1.0 (2) under Guideline 5.1.1(iv) (submission `4cb70b1c`,
 * 2026-10-01): a sheet of ours came before the camera and photo prompts, its button said
 * «Consenti», and «Non ora» closed it without the system request ever being made. Marco's ruling
 * the same day removed the pattern rather than rewording it: a tap on the feature fires the OS
 * prompt DIRECTLY, and custom UI appears only after a refusal the OS can no longer re-ask, where
 * it offers Settings.
 *
 * That is a rule about what is NOT rendered, which no render test can hold, so it is held by
 * where a prompt can be fired from:
 *
 *   1. the functions that call the OS (`request…PermissionsAsync`, a `requestPermission()` from
 *      a permission hook) live in a closed list of files. A new ask cannot land without being
 *      added here, which is the moment to check it is fired from the feature's own tap.
 *   2. the `ensure…Permission` wrappers have a closed list of callers, for the same reason.
 *   3. the one sheet the permission path still owns offers Settings and a way out, and nothing
 *      that could start a request — so it cannot grow back into a primer by gaining a button.
 *   4. `MediaSheet`'s rows reach the OS through one handler, which asks BEFORE it shows anything.
 *
 * The retired copy is pinned out of the catalogs in `packages/i18n/src/i18n.test.ts`.
 *
 * ## What it cannot see
 *
 * A screen that renders its own explanation and then calls an `ensure…` wrapper it is registered
 * for. `checkin.tsx` was that shape. The registries make every asking file a named decision; they
 * do not read the JSX around the call. A reviewer does.
 */
describe('nothing of ours stands in front of an OS permission prompt (#908)', () => {
  const inApp = (p: string) => p.startsWith(SRC) && !p.endsWith('.test.ts');
  const filesMatching = (pattern: RegExp) =>
    FILES.filter(inApp)
      .filter((p) => pattern.test(stripComments(read(p))))
      .map((p) => rel(p).replace('apps/native/src/', ''))
      .sort();

  it('the OS is asked from a closed list of files', () => {
    expect(
      // By NAME, not by call: `onPress={requestPermission}` and a permission hook asked to
      // request on mount (`{ request: true }`) fire the dialog with no `(` after the name.
      filesMatching(/\brequest[A-Za-z]*Permissions?Async\b|\buse[A-Za-z]*Permissions\(/),
      'a file asks the OS for a permission and is not registered, or a registered one no longer ' +
        'does. A new ask fires from the tap on the feature it serves, with nothing of ours shown ' +
        'first — no explanatory sheet, no «Consenti», no «Non ora» (Guideline 5.1.1(iv), #908).',
    ).toEqual(
      [
        'app/(modal)/event-create.tsx',
        'app/(modal)/event/[id]/checkin.tsx',
        'components/live/VicinoPanel.tsx',
        'lib/calendar.ts',
        'lib/media/permissions.ts',
        'lib/push.ts',
      ].sort(),
    );
  });

  it('the ensure wrappers are called from a closed list of files', () => {
    const callers = filesMatching(/\bensure(Camera|Microphone|Push)Permission\(/).filter(
      // The two files that DEFINE them match their own declarations.
      (p) => p !== 'lib/media/permissions.ts' && p !== 'lib/push.ts',
    );
    expect(
      callers,
      'an ensure…Permission wrapper gained or lost a caller. Each one fires the OS dialog, so ' +
        'each caller is the tap on a feature — never a sheet that introduces the dialog (#908).',
    ).toEqual(
      [
        'app/(modal)/notif-prefs.tsx',
        'components/boot/PushPermissionAsk.tsx',
        'components/media/MediaSheet.tsx',
        'lib/media/use-candidacy-upload.ts',
      ].sort(),
    );
  });

  it('the blocked sheet offers Settings and a way out, and cannot start a request', () => {
    const file = `${SRC}components/media/PermissionBlockedSheet.tsx`;
    expect(
      FILES,
      'the blocked sheet moved — this assertion is vacuous until the path is fixed',
    ).toContain(file);
    const src = stripComments(read(file));
    expect(src, 'the blocked sheet no longer deep-links to Settings').toContain(
      'Linking.openSettings()',
    );
    expect(
      /\b(ensure|request|peek)[A-Za-z]*Permission/.test(src) || /\bonAllow\b/.test(src),
      'the blocked sheet reads or requests a permission, or takes an allow handler. It is shown ' +
        'only AFTER the OS has refused for good; a button on it that starts a request makes it ' +
        'the primer App Review rejected (#908).',
    ).toBe(false);
  });

  it('a MediaSheet row asks the OS before it shows anything of its own', () => {
    const src = stripComments(read(`${SRC}components/media/MediaSheet.tsx`));
    const rows = jsxOpeningTags(src).filter((t) => t.base === 'Row' && !t.raw.includes('onClose'));
    expect(
      rows.length,
      'MediaSheet renders no source row — the walk found nothing',
    ).toBeGreaterThanOrEqual(2);
    expect(
      rows.filter((t) => !/onPress=\{\(\) => void onRow\('/.test(t.raw)).map((t) => t.line),
      'a source row no longer goes through onRow, the one handler that asks the OS first',
    ).toEqual([]);
    // Bounded to onRow's own body: sliced to the end of the file it would also hold the
    // `ensurePermission` helper's declaration, and "onRow asks" could not fail.
    const start = src.indexOf('async function onRow(');
    const end = src.indexOf('\n  }\n', start);
    expect(start, 'MediaSheet no longer declares onRow').toBeGreaterThan(-1);
    const handler = src.slice(start, end);
    const ask = handler.indexOf('ensurePermission(');
    const show = handler.indexOf('setBlockedOpen(true)');
    expect(ask, 'onRow no longer asks the OS').toBeGreaterThan(-1);
    expect(
      show,
      'onRow shows the blocked sheet before it has asked the OS — that order is a primer (#908)',
    ).toBeGreaterThan(ask);
  });
});

// ---------------------------------------------------------------------------------------
// 46 — the app reads `galleria`, never `semantic` (#921)
// ---------------------------------------------------------------------------------------

/**
 * Rule 4, mobile half: `@athanor/config` holds two palettes and the app's is `galleria` (Marco's
 * ruling, 2026-10-03). `semantic` is the web's dark world, and it type-checks here — same
 * package, same key names, every value a valid colour — so a screen that imports it compiles,
 * lints and renders, in the wrong look, with nothing to say so.
 *
 * By NAME over comment-stripped code, test files included: a test that recomputes a ratio or
 * pins a config value from `semantic` certifies a colour the app does not draw. A comment may
 * still say the word — the history of a retune is the decision record. `stripComments` leaves
 * string bodies in place, so an assertion message that names the web palette as the remedy is
 * caught too.
 */
describe('the app reads galleria, never semantic (#921)', () => {
  it('no file under src names the web palette in code', () => {
    const hits = codeLines()
      .filter(([, t]) => /\bsemantic\b/.test(t))
      .map(([where, t]) => `${where}  ${t.trim()}`);
    expect(
      hits,
      'apps/native reads `galleria` from @athanor/config. `semantic` is the web palette, and ' +
        'the same key exists on `galleria` (rule 4, docs/DESIGN.md §3).',
    ).toEqual([]);
  });

  it('…and the palette it does read is still read somewhere', () => {
    // The walk above also passes on a tree that went back to literals or reads no token at all.
    expect(codeLines().some(([, t]) => /\bgalleria\.[a-zA-Z]/.test(t))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------
// 47 — the cyan pill stands on the five celebration screens and nowhere else (#921)
// ---------------------------------------------------------------------------------------

/**
 * Rule 4, mobile half (Marco's ruling, 2026-10-03): cyan is a small mark, never an action
 * colour, and a test holds the list of places it may stand. One pill is cyan — `Button`'s
 * `celebration` variant — and it belongs to the five celebration screens: match, new level,
 * favour done, candidacy sent, contribution thanks (DESIGN §2.3, §9). On any other screen it
 * type-checks, lints and renders, as the action colour the rule retired.
 *
 * Two halves, because either one alone can be walked around. The CALL SITES are an exact set of
 * files, as `GLOW_SURFACES` is above; and the COMPONENT may put cyan in that one variant only,
 * or a retune of `primary` would turn every other pill in the app cyan under a green allowlist.
 *
 * What this does not pin: a hand-rolled `bg-aura` Pressable is not a `Button`, and the screens
 * still carry some. Each leaves with its own screen's conversion (#921, open as of 2026-10-04),
 * and the last of those owes the whole-tree cyan list.
 */

/**
 * The top-level entries of the object literal assigned to `const <name>`, as `key → body text`.
 * Naive on purpose: it walks braces and quotes, which is all a table of class strings needs.
 */
function objectEntries(src: string, name: string): Record<string, string> {
  const at = src.indexOf(`const ${name}`);
  const open = at === -1 ? -1 : src.indexOf('= {', at);
  if (open === -1) return {};
  const entries: Record<string, string> = {};
  let depth = 0;
  let quote = '';
  let start = open + 3;
  for (let i = open + 2; i < src.length; i += 1) {
    const c = src[i] as string;
    if (quote) {
      if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    if ((c === ',' && depth === 1) || depth === 0) {
      const entry = src.slice(start, i).match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*)$/);
      if (entry) entries[entry[1] as string] = entry[2] as string;
      start = i + 1;
      if (depth === 0) break;
    }
  }
  return entries;
}

describe('the cyan pill stands on the five celebration screens and nowhere else (#921)', () => {
  const CELEBRATION_SCREENS = [
    'app/(modal)/candidacy-success.tsx',
    'app/(modal)/contribution-thanks.tsx',
    'app/(modal)/favor.tsx',
    'app/(modal)/level.tsx',
    'app/(modal)/match.tsx',
  ];

  const BUTTON = `${SRC}components/Button.tsx`;

  /** Every `<Button>` the app renders, with the raw text of its opening tag. */
  const buttons = () =>
    FILES.filter((p) => !isTest(p) && p.endsWith('.tsx')).flatMap((p) =>
      jsxOpeningTags(stripComments(read(p)))
        .filter((t) => t.base === 'Button')
        .map((t) => ({ at: `${rel(p).replace('apps/native/src/', '')}:${t.line}`, raw: t.raw })),
    );

  it('finds the Buttons it is walking', () => {
    // A scanner that finds nothing passes both call-site assertions below. 107 on 2026-10-04.
    expect(
      buttons().length,
      'no <Button> found at all — the walk is broken, not the tree',
    ).toBeGreaterThan(80);
  });

  it('every Button names its variant as a literal, or takes the default', () => {
    const computed = buttons()
      .filter(({ raw }) => /\bvariant=\{/.test(raw))
      .map(({ at }) => at);
    expect(
      computed,
      'a `<Button variant={…}>` whose variant is computed:\n' +
        'The list below reads call sites, so a pill whose variant is decided at run time is a ' +
        'pill it cannot place. Branch on the JSX instead — two `<Button>`s, each with its own ' +
        'literal `variant="…"`.',
    ).toEqual([]);
  });

  it('the celebration variant is used on exactly the five celebration screens', () => {
    const owners = [
      ...new Set(
        buttons()
          .filter(({ raw }) => /\bvariant="celebration"/.test(raw))
          .map(({ at }) => at.replace(/:\d+$/, '')),
      ),
    ].sort();
    expect(
      owners,
      'The cyan pill belongs to the five celebration screens (rule 4; DESIGN §2.3, §9). A file ' +
        'that is NEW here is cyan used as an action colour: the primary action is the white ' +
        '`primary`, an action that makes a moment included. A file that is MISSING lost its ' +
        'celebration pill, which is the one cyan control the look keeps.',
    ).toEqual(CELEBRATION_SCREENS);
  });

  it('Button puts cyan in the celebration variant and in no other', () => {
    const variants = objectEntries(stripComments(read(BUTTON)), 'VARIANT_CLASSES');
    expect(
      Object.keys(variants).length,
      'VARIANT_CLASSES was not found in components/Button.tsx as an object literal — the ' +
        'assertion below would pass on an empty table',
    ).toBeGreaterThan(3);
    const cyan = Object.entries(variants)
      .filter(([, body]) => /aura/i.test(body))
      .map(([variant]) => variant);
    expect(
      cyan,
      'a Button variant other than `celebration` reads an `aura` class or token. Every call ' +
        'site of that variant turns cyan with it, and the allowlist above stays green.',
    ).toEqual(['celebration']);
  });
});

// ---------------------------------------------------------------------------------------
// 48 — a type class stands alone (#921)
// ---------------------------------------------------------------------------------------

/**
 * DESIGN §4: a `type-*` class sets size, line height and face together, five of the nine set
 * a tracking too, and the rule is unlayered, so it beats a Tailwind utility whatever the order
 * in `className`. What a converted call site leaves beside it therefore fails in one of two
 * silent ways:
 *
 *   - a size or a `leading-*` utility does nothing. It is dead, and it reads as if it were not;
 *   - `type-body`, `type-small`, `type-label` and `type-quote` state NO tracking, so a
 *     `tracking-*` left beside one of them still applies: the old letterspaced label, drawn at
 *     the new size. `uppercase` survives the same way, and the mobile look has no uppercase
 *     style (§4).
 *
 * A weight utility is the one neighbour that is meant to win («a row's title is `type-body
 * font-medium`») — except beside `type-quote`, where the weight's upright face replaces the
 * italic one and the dream register is gone.
 *
 * Read one string literal at a time. A class list split across `cn()` arguments is checked
 * argument by argument, so a utility in a SIBLING argument is not seen: this catches the
 * leftover in the string that was edited, which is the common case, not every composition.
 */
describe('a type class stands alone (#921)', () => {
  const TYPE_CLASS = /(?<![\w-])type-(?:h1|title|h2|body|small|label|quote|num-m|num)(?![\w-])/;
  const NEIGHBOURS: [RegExp, string][] = [
    [/(?<![\w-])tracking-[\w[\].-]+/, 'a tracking utility'],
    [/(?<![\w-])uppercase(?![\w-])/, '`uppercase`'],
    [/(?<![\w-])leading-[\w[\].-]+/, 'a `leading-*` utility'],
    [/(?<![\w-])text-(?:\[\d+(?:\.\d+)?px\]|xs|sm|base|lg|[2-9]?xl)(?![\w-])/, 'a size utility'],
  ];
  const WEIGHT =
    /(?<![\w-])font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)(?![\w-])/;

  /** Every string literal on a code line that carries a type class. */
  const literals = () =>
    CODE_LINES.filter(([p]) => !isTest(p)).flatMap(([p, ls]) =>
      ls.flatMap((text, i) =>
        [...text.matchAll(/(['"`])((?:(?!\1).)*)\1/g)]
          .map((m) => m[2] as string)
          .filter((classes) => TYPE_CLASS.test(classes))
          .map((classes) => ({
            at: `${rel(p).replace('apps/native/src/', '')}:${i + 1}`,
            classes,
          })),
      ),
    );

  it('finds the type classes it is walking', () => {
    // No call site used one before 2026-10-04, and a scanner that finds nothing passes below.
    expect(
      literals().length,
      'no `type-*` class found in any string literal — the walk is broken, or the last call ' +
        'site that used one is gone',
    ).toBeGreaterThan(0);
  });

  it('no size, line-height, tracking or uppercase utility sits beside one', () => {
    const hits = literals().flatMap(({ at, classes }) =>
      NEIGHBOURS.filter(([re]) => re.test(classes)).map(
        ([, what]) => `${at}  ${what} beside a type class: "${classes}"`,
      ),
    );
    expect(
      hits,
      'a utility a type class makes dead, or one it fails to cancel:\n' +
        'The class owns size, line height and tracking (DESIGN §4). Delete the utility; if the ' +
        'text really needs another size, it is not that style — use the right `type-*` class ' +
        'or one of the two fixed sizes §4 names, with no type class beside it.',
    ).toEqual([]);
  });

  it('no weight utility sits beside type-quote', () => {
    const hits = literals()
      .filter(
        ({ classes }) => /(?<![\w-])type-quote(?![\w-])/.test(classes) && WEIGHT.test(classes),
      )
      .map(({ at, classes }) => `${at}  "${classes}"`);
    expect(
      hits,
      'a weight beside `type-quote`: on device a weight IS a font face, so it replaces the ' +
        'italic one and the dream register reads as plain text (DESIGN §4).',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 49 — a press is spelled in one module, and its scale asks Reduce Motion (#921)
// ---------------------------------------------------------------------------------------

/**
 * DESIGN §10: a press answers — a pill dims to 0.6 and scales to 0.98; a chip, a row or an icon
 * dims — and under Reduce Motion a transition becomes an opacity cut. The CSS runtime cannot
 * ask that question itself: `react-native-css@3.0.7` evaluates no `prefers-reduced-motion`
 * media query (`testComparison` in its `native/conditions/media-query.ts` has no case for it,
 * read 2026-10-04), so a `motion-safe:` variant is not a way to write it and a hand-typed
 * `active:scale-*` scales for everyone. `lib/press.ts` is the one place the classes are
 * spelled, and its `pillPress` takes the flag from `useReducedMotion()` as an argument, which
 * `lib/press.test.ts` holds.
 */
describe('a press is spelled in one module, and its scale asks Reduce Motion (#921)', () => {
  const HOME = ['apps/native/src/lib/press.ts', 'apps/native/src/lib/press.test.ts'];
  const PRESS_CLASS = /(?<![\w-])active:(?:opacity|scale)-/;
  const at = (where: string) => where.replace(/:\d+$/, '');

  it('finds the press classes it is walking', () => {
    expect(
      codeLines().some(([where, t]) => at(where) === HOME[0] && PRESS_CLASS.test(t)),
      'lib/press.ts no longer spells an `active:` class — the walk below passes on a tree ' +
        'where nothing answers a press',
    ).toBe(true);
  });

  it('no file spells a press class of its own', () => {
    const hits = codeLines()
      .filter(([where, t]) => !HOME.includes(at(where)) && PRESS_CLASS.test(t))
      .map(([where, t]) => `${where}  ${t.trim().slice(0, 100)}`);
    expect(
      hits,
      'an `active:opacity-*` or `active:scale-*` written at a call site:\n' +
        'Take `PRESS_DIM` (a chip, a row, an icon, a text link) or `pillPress(reduceMotion)` ' +
        '(a pill) from `@/lib/press`. A scale typed here ignores Reduce Motion, and a second ' +
        'dim value is a second pressed look (DESIGN §10).',
    ).toEqual([]);
  });

  it('nobody answers the Reduce Motion question with a constant', () => {
    const hits = codeLines()
      .filter(
        ([where, t]) => !HOME.includes(at(where)) && /\bpillPress\(\s*(?:true|false)\s*\)/.test(t),
      )
      .map(([where, t]) => `${where}  ${t.trim().slice(0, 100)}`);
    expect(
      hits,
      "`pillPress(true|false)`: the argument is the member's setting, from " +
        '`useReducedMotion()` (`@/hooks/use-reduced-motion`), never a literal.',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 50 — chips, tags and fields keep the Galleria shape (#921)
// ---------------------------------------------------------------------------------------

/**
 * DESIGN §9 on the primitives every form and every filter is built from: `Chip`, `Tag`, `Input`
 * and `Field`. Each line below is a look that fails silently — the control still works, it is
 * only wrong — and each was the shipped look until 2026-10-04:
 *
 *   - **No cyan.** A selected chip is the foreground fill. Rule 4 keeps `aura` off every
 *     selected state, and a chip was the most common one (`bg-aura-soft` + `border-aura-line`).
 *   - **No fill on a chip or a tag at rest.** The `raise-2` fill is the surface on which the
 *     secondary grey is 3.85:1 (`contrast.test.ts`); a quiet `Tag` on no fill reads on the
 *     stage or on a block, where that grey clears AA. A fill coming back brings the failure
 *     with it.
 *   - **A chip is 32pt tall and its target is 44.** `min-h`, so a large text size grows it, and
 *     `hitSlop` for the rest: §10's floor is on the target, not on the drawing.
 *   - **A press always answers.** `PRESS_DIM` sits in the class list unconditionally: an
 *     `active:` class that appears after the first render remounts the children
 *     (`lib/press.ts` says where that was read).
 *   - **A field is a 50pt `surface` pill with no border at rest.** The border is there, in
 *     `transparent`, so focus and error colour it without moving the text by a pixel.
 *   - **A field's vertical padding is physical.** `py-*` compiles to `padding-block`, and a
 *     multi-line iOS `TextInput` draws its text as if that were absent: 8pt higher than with
 *     `pt-`/`pb-` on an iPhone SE simulator (2026-10-04; `Input`'s docblock has the figures).
 *     It is §40's finding on the other axis, held here for the two files that build fields.
 */
describe('chips, tags and fields keep the Galleria shape (#921)', () => {
  const code = (f: string) => stripComments(read(`${SRC}components/${f}`));
  const PRIMITIVES = ['Chip.tsx', 'Tag.tsx', 'Input.tsx', 'Field.tsx', 'LocaleChips.tsx'];

  it('none of them names a cyan class', () => {
    const hits = PRIMITIVES.flatMap((f) =>
      [...code(f).matchAll(/(?<![\w-])(?:text|bg|border)-(?:aura|on-aura)[\w-]*/g)].map(
        (m) => `components/${f}  ${m[0]}`,
      ),
    );
    expect(
      hits,
      'cyan on a chip, a tag or a field: a selected chip is the foreground fill, a focused ' +
        'field takes a foreground border (rule 4, DESIGN §9)',
    ).toEqual([]);
  });

  it('a chip fills only when selected, and a tag never', () => {
    const fills = (f: string) =>
      [...code(f).matchAll(/(?<![\w-])bg-[\w-]+(?:\/\d+)?/g)].map((m) => m[0]);
    expect(fills('Chip.tsx'), 'the selected chip is the one fill a chip has').toEqual([
      'bg-foreground',
    ]);
    expect(fills('Tag.tsx'), 'a tag is a hairline pill with nothing behind its text').toEqual([]);
  });

  it('a chip is 32pt tall with a 14px label, and its target reaches 44pt', () => {
    const chip = code('Chip.tsx');
    expect(chip, 'the chip lost its `min-h-[32px]` floor').toMatch(/(?<![\w-])min-h-\[32px\]/);
    expect(chip, 'a fixed height on a chip clips its label at a large text size').not.toMatch(
      /(?<![\w-])h-\[\d+px\]/,
    );
    expect(chip, 'the chip label is the fixed 14px size (DESIGN §4)').toMatch(
      /(?<![\w-])text-\[14px\]/,
    );
    const slop = chip.match(/top:\s*(\d+),\s*bottom:\s*(\d+)/);
    expect(slop, 'the chip lost its vertical `hitSlop`').not.toBeNull();
    expect(chip, 'the slop is declared but not handed to the Pressable').toMatch(/\bhitSlop=\{/);
    expect(
      32 + Number(slop?.[1]) + Number(slop?.[2]),
      'a 32pt chip and its vertical slop must make the 44pt target (DESIGN §10)',
    ).toBeGreaterThanOrEqual(44);
  });

  it('a tag draws the same pill as a chip, at the same label size', () => {
    const tag = code('Tag.tsx');
    expect(tag).toMatch(/(?<![\w-])min-h-\[32px\]/);
    expect(tag).toMatch(/(?<![\w-])text-\[14px\]/);
  });

  it('a chip always carries the pressed state', () => {
    const chip = code('Chip.tsx');
    expect(chip, 'the chip does not take `PRESS_DIM` from lib/press').toMatch(
      /import \{[^}]*\bPRESS_DIM\b[^}]*\} from '@\/lib\/press'/,
    );
    expect(
      chip.match(/(?:&&|\?|:)\s*PRESS_DIM\b/),
      'a conditional `PRESS_DIM`: the class must be there from the first render',
    ).toBeNull();
    expect(chip, '`PRESS_DIM` is imported and never put in a class list').toMatch(
      /[(,]\s*PRESS_DIM\s*[,)]/,
    );
  });

  it.each(['Input.tsx', 'Field.tsx'])(
    '%s is a 50pt surface pill with a border that only shows on focus or error',
    (f) => {
      const src = code(f);
      expect(src, 'the field lost its `min-h-[50px]` floor').toMatch(/(?<![\w-])min-h-\[50px\]/);
      expect(src, 'the field fills with `surface`').toMatch(/(?<![\w-])bg-surface(?![\w-])/);
      expect(src, 'a legacy fill on the field').not.toMatch(/(?<![\w-])bg-raise/);
      expect(src, 'the rest border is transparent, so focus moves nothing').toMatch(
        /(?<![\w-])border-transparent(?![\w-])/,
      );
      expect(src, 'a hairline at rest: the Galleria field has no rest border').not.toMatch(
        /(?<![\w-])border-hair(?![\w-])/,
      );
    },
  );

  it('the files that build fields spell vertical padding physically', () => {
    const hits = ['Input.tsx', 'Field.tsx'].flatMap((f) => {
      const src = code(f);
      return [...src.matchAll(/(['"`])((?:(?!\1)[^\\\n])*)\1/g)].flatMap((lit) =>
        [...(lit[2] as string).matchAll(/(?<![\w-])-?(?:py|my)-[\w[\].]+/g)].map(
          (m) => `components/${f}:${src.slice(0, lit.index).split('\n').length}  ${m[0]}`,
        ),
      );
    });
    expect(
      hits,
      'use `pt-N pb-N`: a multi-line iOS TextInput draws its text as if `py-N` were not there',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------

/**
 * Rule 4, mobile half, for the shared surfaces and text primitives (#921, 2026-10-04).
 *
 * Cyan is five marks (DESIGN §2.3). Two of them pass through a shared component: the member's
 * own Aura numeral (`AuraValue`) and the one-line label of a celebration screen (`SectionLabel
 * tone="celebration"`). Everything else these components draw is white or grey — a progress
 * fill, a step, a toast's mark, a spinner, a pull-to-refresh tint — and none of it glows or
 * turns green. Each of those type-checks, lints and renders in cyan, which is how the action
 * colour would come back: one component at a time, on every screen that mounts it.
 */
describe('surfaces and text primitives keep the Galleria look (#921)', () => {
  const CELEBRATION_SCREENS = [
    'app/(modal)/candidacy-success.tsx',
    'app/(modal)/contribution-thanks.tsx',
    'app/(modal)/favor.tsx',
    'app/(modal)/level.tsx',
    'app/(modal)/match.tsx',
  ];

  /** The shared components that carry no cyan, no green and no glow at all. */
  const PLAIN = [
    'Avatar',
    'Card',
    'DreamQuote',
    'EmptyState',
    'ListState',
    'LoadingScreen',
    'Mandorla',
    'MandorlaMark',
    'ProgressBar',
    'RecoverySent',
    'Screen',
    'ShimmerBar',
    'StatLine',
    'StepBars',
    'StepDots',
    'SuspendedNotice',
    'Toast',
  ];

  const component = (name: string) => stripComments(read(`${SRC}components/${name}.tsx`));

  /** Every opening tag of `base` in the app, with the file it stands in. */
  const tags = (base: string) =>
    FILES.filter((p) => !isTest(p) && p.endsWith('.tsx')).flatMap((p) =>
      jsxOpeningTags(stripComments(read(p)))
        .filter((t) => t.base === base)
        .map((t) => ({
          file: rel(p).replace('apps/native/src/', ''),
          at: `${rel(p).replace('apps/native/src/', '')}:${t.line}`,
          raw: t.raw,
        })),
    );

  it('finds the tags it is walking', () => {
    // A scanner that finds nothing passes every call-site assertion below. On 2026-10-04:
    // 111 labels, 26 spinners, 5 refresh controls.
    expect(tags('SectionLabel').length, 'no <SectionLabel> found').toBeGreaterThan(80);
    expect(tags('ActivityIndicator').length, 'no <ActivityIndicator> found').toBeGreaterThan(15);
    expect(tags('RefreshControl').length, 'no <RefreshControl> found').toBeGreaterThan(2);
  });

  it('none of the plain components names cyan, green or the glow', () => {
    const hits = PLAIN.filter((name) =>
      /(?<![\w-])(?:text|bg|border)-(?:aura|success)|galleria\.(?:aura|success)|auraGlow/.test(
        component(name),
      ),
    );
    expect(
      hits,
      'a shared surface or text primitive reads `aura`, `success` or `auraGlow()`. Every screen ' +
        'that mounts it turns cyan, green or glowing with it. A fill, a step and a mark are ' +
        '`foreground`; what is not lit is `hair`; a confirmation is a ✓ and words (DESIGN §2.3).',
    ).toEqual([]);
  });

  it('SectionLabel is the label style, and cyan only in its celebration tone', () => {
    const src = component('SectionLabel');
    expect(src, 'the label is `type-label`').toMatch(/(['"])type-label\1/);
    const tones = objectEntries(src, 'TONE');
    expect(
      Object.keys(tones).sort(),
      'SectionLabel has two tones: the plain grey label and the celebration one',
    ).toEqual(['celebration', 'plain']);
    expect(tones.plain, 'the plain label is the secondary grey').toMatch(/text-muted-foreground/);
    expect(tones.plain, 'the plain label is not cyan').not.toMatch(/aura/);
  });

  it('a label names its tone as a literal, and only a celebration screen takes the cyan one', () => {
    const labels = tags('SectionLabel');
    expect(
      labels.filter(({ raw }) => /\btone=\{/.test(raw)).map(({ at }) => at),
      'a `<SectionLabel tone={…}>` whose tone is computed: the list below cannot place it',
    ).toEqual([]);
    expect(
      labels.filter(({ raw }) => /\btone="(?!celebration")/.test(raw)).map(({ at }) => at),
      'a tone the label no longer has. A section label is plain grey: drop the prop.',
    ).toEqual([]);
    const owners = [
      ...new Set(
        labels.filter(({ raw }) => /\btone="celebration"/.test(raw)).map(({ file }) => file),
      ),
    ].sort();
    expect(
      owners,
      'The cyan label is the one line above the title of a celebration screen (rule 4; DESIGN ' +
        '§2.3). A file that is NEW here is cyan used as an eyebrow: the label is grey. A file ' +
        'that is MISSING lost the label the look keeps cyan.',
    ).toEqual(CELEBRATION_SCREENS);
  });

  it('a spinner and a pull-to-refresh tint are never cyan', () => {
    const cyan = [...tags('ActivityIndicator'), ...tags('RefreshControl')]
      .filter(({ raw }) => /galleria\.aura/.test(raw))
      .map(({ at }) => at);
    expect(
      cyan,
      'a spinner or a refresh tint in `aura`: waiting is not one of the five cyan marks ' +
        '(DESIGN §2.3). Use `galleria.foreground`, or `galleria.foregroundMuted` where the ' +
        'spinner is the quietest thing on the screen.',
    ).toEqual([]);
  });

  it('the avatar has five sizes', () => {
    const src = component('Avatar');
    // `objectEntries` reads identifier keys; this table's keys are numbers.
    const table = src.match(/const INITIAL_SIZE = \{([^}]*)\}/)?.[1] ?? '';
    const sizes = [...table.matchAll(/(\d+)\s*:/g)].map((m) => Number(m[1]));
    // The story ring held a sixth, 60, until its screen converted (2026-10-05); its disc is 56.
    expect(sizes, 'the avatar sizes of DESIGN §9').toEqual([30, 44, 56, 72, 104]);
  });
});

// ---------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------

/**
 * Rule 4, mobile half, for the grouped rows and the switch (#921, 2026-10-04).
 *
 * A list is rows inside one `surface` block (DESIGN §9 «Grouped rows»): `RowGroup` draws the
 * block and the hairlines, `Row` draws a row. A toggle is the app's own `Switch` (§9), a
 * `Pressable` with the `switch` role: the platform switch takes its colours as props from every
 * call site, which is seven places to turn cyan again. These pin the shapes a walk would otherwise have to re-measure, and the two things that
 * bring the old look back: a second row component, and a platform switch.
 */
describe('grouped rows and the switch keep the Galleria shape (#921)', () => {
  const component = (name: string) => stripComments(read(`${SRC}components/${name}.tsx`));
  const appCode = () =>
    FILES.filter((p) => !isTest(p)).map((p) => [rel(p), stripComments(read(p))] as const);

  it('the switch is a 46×28 pressable with the switch role and a 44pt target', () => {
    const src = component('Switch');
    expect(src, 'the role').toMatch(/accessibilityRole="switch"/);
    expect(src, 'the checked state').toMatch(/accessibilityState=\{\{[^}]*\bchecked\b/);
    expect(src, '46 wide').toMatch(/w-\[46px\]/);
    expect(src, '28 tall').toMatch(/(?<![\w-])h-7(?![\w-])/);
    // 28 + 8 + 8 = 44 (DESIGN §10). The width is already past the floor.
    expect(src, 'hitSlop makes up the height').toMatch(/SWITCH_SLOP = \{ top: 8, bottom: 8 \}/);
    expect(src, 'and the control takes it').toMatch(/hitSlop=\{SWITCH_SLOP\}/);
    expect(src, 'the press is the shared dim').toMatch(/\bPRESS_DIM\b/);
    expect(src, 'it names itself: the prop is required').toMatch(/accessibilityLabel: string/);
  });

  it('the switch is white when on, a grey outline when off, and never cyan', () => {
    const src = component('Switch');
    expect(src, 'on = a foreground track').toMatch(/bg-foreground/);
    expect(src, 'on = a background knob').toMatch(/bg-background/);
    expect(src, 'off = a secondary-grey outline').toMatch(/border-muted-foreground/);
    expect(src, 'off = a grey knob').toMatch(/bg-muted-foreground/);
    expect(src, 'no cyan, no green, no glow, no colour read in TS').not.toMatch(
      /aura|success|galleria\./,
    );
  });

  it('nothing imports the platform switch', () => {
    const hits = appCode()
      .filter(([, src]) => /import\s*\{[^}]*\bSwitch\b[^}]*\}\s*from\s*'react-native'/.test(src))
      .map(([at]) => at);
    expect(
      hits,
      'the platform `Switch` takes its colours from the call site. Import `Switch` from ' +
        '`@/components/Switch` (DESIGN §9).',
    ).toEqual([]);
  });

  it('a row is one 60pt button with a 17/500 title and a 15 grey second line', () => {
    const src = component('Row');
    expect(src, 'min-h 60, never a fixed height').toMatch(/(?<![\w-])min-h-15(?![\w-])/);
    expect(src, 'the title').toMatch(/type-body font-medium/);
    expect(src, 'the second line and the value').toMatch(/type-small text-muted-foreground/);
    expect(src, 'a destructive title is the error red').toMatch(/text-error/);
    expect(src, 'one accessible control: a button, or a switch when it is `checked`').toMatch(
      /accessibilityRole=\{isSwitch \? 'switch' : 'button'\}/,
    );
    expect(src, 'the press is the shared dim').toMatch(/\bPRESS_DIM\b/);
    expect(
      src.match(/numberOfLines=\{[^}]*\}/g)?.sort(),
      'a long title, value or second line wraps unless the call site asks for a clamp',
    ).toEqual(['numberOfLines={descriptionLines}', 'numberOfLines={titleLines}']);
    expect(src, 'no cyan').not.toMatch(/aura/);
  });

  it('a row takes a leading element, 12 from its text, and draws it first', () => {
    const src = component('Row');
    expect(src, 'the slot takes any element, as `trailing` does').toMatch(/leading\?: ReactNode;/);
    const shape = /const shape = '([^']*)'/.exec(src)?.[1] ?? '';
    expect(shape.split(' '), 'the row’s one gap is the prototype’s 12').toContain('gap-3');
    expect(
      src.replace(/\s+/g, ' '),
      'the leading element is the first child of the row, at every text size',
    ).toMatch(/const body = \( <> \{leading\} <View className=\{stacked \?/);
    expect(src, 'the row does not know what it leads with').not.toMatch(/\bAvatar\b/);
    expect(src, 'a second line may be an element with its own register').toMatch(
      /description\?: ReactNode;/,
    );
  });

  it('an avatar leading a row that acts is decorative: the row says the name', () => {
    const led = appCode().flatMap(([at, src]) =>
      jsxOpeningTags(src)
        .filter((t) => t.base === 'Row' && /\bleading=\{/.test(t.raw))
        .map((t) => ({ at: `${at}:${t.line}`, raw: t.raw })),
    );
    // A scanner that finds nothing passes the assertion below.
    expect(led.length, 'no `<Row leading=` found at all').toBeGreaterThanOrEqual(2);
    const spoken = led
      .filter((t) => /\bonPress=\{/.test(t.raw) && /<Avatar\b/.test(t.raw))
      .filter((t) => !/<Avatar\b[^>]*?\sdecorative(?=[\s/>])/.test(t.raw))
      .map((t) => t.at);
    expect(
      spoken,
      'a pressable `Row` is one button named by its label; a labelled `Avatar` in its ' +
        '`leading` says the name a second time (#884). Pass `decorative`.',
    ).toEqual([]);
  });

  it('a row that is the toggle carries the role and the state, and draws the switch inert', () => {
    const src = component('Row').replace(/\s+/g, ' ');
    expect(src, 'the form is asked for by `checked`').toMatch(/checked: boolean;/);
    expect(src, 'the state is the row’s').toMatch(
      /accessibilityState=\{isSwitch \? \{ checked \} : undefined\}/,
    );
    expect(src, 'a string second line is the hint (#635: the «why» under the «what»)').toMatch(
      /accessibilityHint=\{isSwitch && typeof description === 'string' \? description : undefined\}/,
    );
    // One tap anywhere flips it once (#748): the drawn switch takes no touch and is not a second
    // element for a screen reader, and it has no `onValueChange` of its own.
    expect(src, 'the switch is hidden, touch-inert and only draws the state').toMatch(
      /<View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" > <Switch accessibilityLabel=\{accessibilityLabel \?\? title\} value=\{checked\} \/> <\/View>/,
    );
    expect(src, 'a toggle has no chevron').toMatch(/showChevron && onPress != null && !isSwitch/);
  });

  it('no file builds a row that is a switch by hand', () => {
    const OWNERS = ['components/Switch.tsx', 'components/Row.tsx'];
    const hits = appCode()
      .filter(([at]) => !OWNERS.some((o) => at.endsWith(o)))
      // The literal and the expression forms: `Row` itself spells it `{isSwitch ? 'switch' : …}`
      // (Greptile, PR 941).
      .filter(([, src]) => /accessibilityRole=(?:"switch"|\{[^}]*['"`]switch['"`])/.test(src))
      .map(([at]) => at);
    expect(
      hits,
      'the switch role typed in a screen: a toggle beside its text is `Switch` in a row’s ' +
        '`trailing`, and a row that is the toggle is `<Row checked={…} onPress={…} />` ' +
        '(DESIGN §9 «Grouped rows»)',
    ).toEqual([]);
  });

  it('no file builds the row by hand', () => {
    const hits = appCode()
      .filter(([at]) => !at.endsWith('components/Row.tsx'))
      .filter(([, src]) => /(?<![\w-])min-h-15 flex-row items-center/.test(src))
      .map(([at]) => at);
    expect(
      hits,
      'the row recipe written out in a second file: `Row` takes a `leading` element, a ' +
        '`trailing` one and line clamps (DESIGN §9 «Grouped rows»)',
    ).toEqual([]);
  });

  it('a group is one borderless surface block, radius 28, with hairlines between rows', () => {
    const src = component('RowGroup');
    expect(src, 'radius 28').toMatch(/rounded-\[28px\]/);
    expect(src, 'the surface fill').toMatch(/bg-surface(?![\w-])/);
    expect(src, 'the hairline between rows').toMatch(/bg-hair/);
    expect(src, 'no border on the block, no legacy fill').not.toMatch(/border-hair|bg-raise/);
  });

  it('there is one row component', () => {
    const hits = FILES.map((p) => [rel(p), stripComments(read(p))] as const)
      .filter(([, src]) => /\bSettings(?:Group|Row)\b/.test(src))
      .map(([at]) => at);
    expect(hits, '`SettingsGroup` / `SettingsRow` became `RowGroup` / `Row`').toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// icons, header controls and the tab bar (#921)
// ---------------------------------------------------------------------------------------

/**
 * Rule 4, mobile half, for the icons, the header controls and the tab bar (#921, 2026-10-04).
 *
 * One drawn icon set at one stroke (DESIGN §6 «Interface icons»): the nine interface icons
 * live in `components/glyphs.tsx` beside the tab glyphs, and every drawing there takes its
 * stroke from one constant. A header's back and close are those drawings inside one 44pt
 * control (`HeaderBack`, `HeaderClose` in `components/ModalHeader.tsx`), never a typed
 * character. The tab bar is black under a hairline, and a waiting Momento is an 8px cyan dot
 * on the Momenti glyph (§9 «Tab bar»), the only cyan in the bar.
 */
describe('icons, header controls and the tab bar keep the Galleria shape (#921)', () => {
  const glyphs = () => stripComments(read(`${SRC}components/glyphs.tsx`));
  const header = () => stripComments(read(`${SRC}components/ModalHeader.tsx`));
  const tabs = () => stripComments(read(`${SRC}app/(tabs)/_layout.tsx`));
  const INTERFACE = ['add', 'back', 'clock', 'close', 'more', 'people', 'pin', 'send', 'share'];

  it('every drawing takes the one 1.8 stroke', () => {
    const src = glyphs();
    expect(src, 'the stroke, stated once').toMatch(/const STROKE = 1\.8;/);
    expect(
      src.match(/strokeWidth\b[^,\n]*/g),
      'a `strokeWidth` that is not the constant: header icons drew at 2 until Galleria',
    ).toEqual(['strokeWidth: STROKE']);
  });

  it('the interface icons are the nine of DESIGN §6', () => {
    const table = /export const INTERFACE_ICONS = \{([^}]*)\}/.exec(glyphs())?.[1] ?? '';
    const names = [...table.matchAll(/(\w+):/g)].map((m) => m[1]).sort();
    expect(names).toEqual(INTERFACE);
  });

  it('the Profilo tab is the person, not the meridian sphere', () => {
    const body = /export function ProfiloGlyph[\s\S]*?\n\}/.exec(glyphs())?.[0] ?? '';
    expect(body, 'a head').toMatch(/<Circle cx=\{12\} cy=\{8\.5\} r=\{3\.6\}/);
    expect(body, 'over a shoulder arc').toMatch(/<Path d="M4\.5 20a7\.5 7\.5 0 0 1 15 0"/);
    expect(body, 'no meridian').not.toMatch(/Ellipse|<Line/);
  });

  it('a header control is a drawing in a 44pt labelled button, never a typed character', () => {
    const src = header();
    expect(src, 'a typed back or close').not.toMatch(/[‹›✕×]/);
    for (const name of ['HeaderBack', 'HeaderClose']) {
      expect(src, `${name} is exported`).toMatch(new RegExp(`export function ${name}\\(`));
    }
    expect(src, 'the drawn back').toMatch(/<BackIcon\b/);
    expect(src, 'the drawn close').toMatch(/<CloseIcon\b/);
    const box = /const ICON_BUTTON =\s*'([^']*)'/.exec(src)?.[1] ?? '';
    expect(box, 'the 44pt box (DESIGN §10)').toMatch(/min-h-\[44px\] min-w-\[44px\]/);
    expect(src, 'the press is the shared dim').toMatch(/\bPRESS_DIM\b/);
    expect(src, 'the label is required').toMatch(/label: string/);
    expect(src, 'the role').toMatch(/accessibilityRole="button"/);
    expect(src, 'the drawing is silent on iOS').toMatch(/accessibilityElementsHidden/);
    expect(src, 'and on Android').toMatch(/importantForAccessibility="no-hide-descendants"/);
  });

  it('the header band is the prototype’s `.top`: the title in `type-title`, 8 between its parts', () => {
    const src = header();
    expect(
      /const titleClass = compact\s*\?\s*'[^']*'\s*:\s*'([^']*)'/.exec(src)?.[1],
      'the title of a pushed screen or a sheet (DESIGN §6 «Screen headers»); the compact one is chat’s',
    ).toBe('type-title text-foreground');
    expect(src, 'a named size: 21px at the compiler’s rem of 14, not 24').not.toMatch(
      /\btext-2xl\b/,
    );
    const band = /<View className="(flex-row items-center [^"]*px-gutter[^"]*)">/.exec(src)?.[1];
    expect(band?.split(' '), 'the band’s gap is 8 (`.top { gap: 8px }`)').toContain('gap-2');
  });

  it('no screen hand-rolls the back control', () => {
    const hits = codeLines()
      .filter(([where]) => !/\.test\.tsx?:/.test(where))
      .filter(([, text]) => /‹/.test(text))
      .map(([where]) => where.replace('apps/native/src/', '').replace(/:\d+$/, ''));
    expect(
      hits,
      'a typed `‹`: the back control is `HeaderBack` from `@/components/ModalHeader`',
    ).toEqual([]);
  });

  it('the tab bar is black under a hairline, white when selected', () => {
    const src = tabs().replace(/\s+/g, ' ');
    expect(src, 'the ground').toMatch(/backgroundColor: galleria\.background\b/);
    expect(src, 'the hairline colour').toMatch(/borderTopColor: galleria\.hair\b/);
    expect(src, 'the hairline').toMatch(/borderTopWidth: 1\b/);
    expect(src, 'selected = foreground').toMatch(/tabBarActiveTintColor: galleria\.foreground\b/);
    expect(src, 'the rest = the one secondary').toMatch(
      /tabBarInactiveTintColor: galleria\.foregroundMuted\b/,
    );
    expect(src, 'the glyph is 24').toMatch(/const TAB_GLYPH = 24;/);
    expect(src.match(/size=\{TAB_GLYPH\}/g), 'on all five tabs').toHaveLength(5);
  });

  it('a waiting Momento is an 8px cyan dot, the only cyan in the bar', () => {
    const src = tabs();
    expect(src, 'no navigator badge: it was the ✦ character').not.toMatch(/tabBarBadge|✦/);
    expect(src, 'the dot').toMatch(/h-2 w-2 rounded-full bg-aura/);
    expect(src.match(/aura/g), 'one cyan, and none read in TS').toHaveLength(1);
    // The dot stands only while a Momento waits, and the tab says so in words in the same case.
    const flat = src.replace(/\s+/g, ' ');
    expect(flat, 'waiting = the deck is not empty').toMatch(
      /const hasUnseen = \(deck\.data\?\.length \?\? 0\) > 0;/,
    );
    expect(flat, 'no dot when nothing waits').toMatch(
      /\{hasUnseen \? \( <View className="[^"]*\bbg-aura\b[^"]*" \/> \) : null\}/,
    );
    expect(flat, 'the label follows the same flag').toMatch(
      /tabBarAccessibilityLabel: hasUnseen \? t\('tabs\.a11y\.momentiUnread', locale\) : t\('tabs\.momenti', locale\)/,
    );
  });
});

/*
 * The entry screens (#921, the first screen chunk): what a person sees before they are a member,
 * and the four screens the boot can stop on. None of them is a celebration, so none carries cyan
 * (DESIGN §2.3 lists the five marks, and none stands here), and the mobile look has no green.
 * `BrandSplash` is the one exception by ruling: the splash animation stays as it was, only the
 * ground under it went black.
 */
describe('the entry screens keep the Galleria look (#921)', () => {
  const ENTRY_ROUTES = [
    'app/(auth)/_layout.tsx',
    'app/(auth)/forgot-password.tsx',
    'app/(auth)/welcome.tsx',
    'app/(modal)/new-password.tsx',
    'app/(onboarding)/_layout.tsx',
    'app/(onboarding)/handle.tsx',
    'app/(onboarding)/index.tsx',
    'app/+not-found.tsx',
    'app/[handle].tsx',
    'app/auth-callback.tsx',
    'app/invite/[code].tsx',
    'app/momento/[id].tsx',
  ];
  const BOOT = FILES.filter((p) => !isTest(p) && p.includes('/components/boot/')).map((p) =>
    rel(p).replace('apps/native/src/', ''),
  );
  /** Ruling 6: the splash animation keeps its colours. */
  const SPLASH = 'components/boot/BrandSplash.tsx';
  const code = (file: string) => stripComments(read(`${SRC}${file}`));
  /** A colour class or a token read; `result.success` and the word in prose are neither. */
  const CYAN_OR_GREEN =
    /(?<![\w-])(?:text|bg|border)-(?:aura|success)\b|\bgalleria\.(?:aura|success)\w*|\bauraGlow\b/;

  it('the boot folder is the ten files this section was written against', () => {
    expect(BOOT.sort()).toEqual([
      'components/boot/AppErrorScreen.tsx',
      'components/boot/BootGate.tsx',
      'components/boot/BrandSplash.tsx',
      'components/boot/CrashTrailGate.tsx',
      'components/boot/ForceUpdateScreen.tsx',
      'components/boot/MaintenanceScreen.tsx',
      'components/boot/NotificationRouter.tsx',
      'components/boot/ProfileErrorScreen.tsx',
      'components/boot/PushPermissionAsk.tsx',
      'components/boot/SentryConsentGate.tsx',
    ]);
  });

  it('no entry screen carries cyan, green or a glow', () => {
    const hits = [
      ...ENTRY_ROUTES,
      ...BOOT.filter((f) => f !== SPLASH),
      'components/profile/HandleField.tsx',
    ]
      .filter((file) => CYAN_OR_GREEN.test(code(file)))
      .sort();
    expect(
      hits,
      'cyan is five marks (DESIGN §2.3) and none is an entry screen; green left the mobile palette',
    ).toEqual([]);
  });

  it('the splash is the only boot file that reads cyan', () => {
    expect(BOOT.filter((file) => /galleria\.aura\b/.test(code(file)))).toEqual([SPLASH]);
  });

  it('a boot screen draws the outline mandorla, not the vertical lens', () => {
    const lens = BOOT.filter((file) => /@\/components\/Mandorla'/.test(code(file)));
    expect(lens, '`Mandorla` frames an avatar or a ✦; a state screen takes `MandorlaMark`').toEqual(
      [],
    );
    const marked = BOOT.filter((file) => /<MandorlaMark\b/.test(code(file))).sort();
    expect(marked).toEqual([
      'components/boot/AppErrorScreen.tsx',
      'components/boot/ForceUpdateScreen.tsx',
      'components/boot/MaintenanceScreen.tsx',
      'components/boot/ProfileErrorScreen.tsx',
    ]);
  });

  it('an entry screen sizes its text with a type class or a literal px, never a named size', () => {
    const NAMED_SIZE = /(?<![\w-])text-(?:xs|sm|base|lg|xl|[2-9]xl)\b/;
    const LEGACY_SHAPE = /(?<![\w-])(?:leading-[\w[\].-]+|rounded-(?:card|hero|ctl)\b|bg-raise\b)/;
    const hits = [
      ...ENTRY_ROUTES,
      ...BOOT.filter((f) => f !== SPLASH),
      'components/profile/HandleField.tsx',
    ]
      .filter((file) => NAMED_SIZE.test(code(file)) || LEGACY_SHAPE.test(code(file)))
      .sort();
    expect(
      hits,
      'a named size resolves at a rem of 14 on device (`text-sm` is 12.25) and `leading-*` emits nothing',
    ).toEqual([]);
  });
});

/*
 * The Home tab (#921, the second screen chunk). The prototype draws ONE bordered card here, the
 * waiting Momento, and everything else as bare blocks or grouped rows (Marco, 2026-10-05: the
 * blocks it does not draw are borderless too). Cyan stands once on this screen: the 8px dot
 * beside «Hai un Momento» (DESIGN §2.3). The fund block shows days, not seconds, so it carries
 * none; the bell's unread dot is foreground; the member's Aura numeral is not on Home.
 * `live/EventRow` under «In arrivo» is not in this list: it converts with Athanor Live.
 */
describe('the Home tab keeps the Galleria look (#921)', () => {
  const HOME_FOLDER = FILES.filter((p) => !isTest(p) && p.includes('/components/home/'))
    .map((p) => rel(p).replace('apps/native/src/', ''))
    .sort();
  /** `aura/WeekCard` has one caller, `home/WeekSlot`: it is Home's week block. */
  const HOME = ['app/(tabs)/index.tsx', 'components/aura/WeekCard.tsx', ...HOME_FOLDER];
  const MOMENTO = 'components/home/MomentiCard.tsx';
  const code = (file: string) => stripComments(read(`${SRC}${file}`));
  /** Cyan or green by class, token, literal or the old palette; a glow by helper or shadow. */
  const CYAN_OR_GREEN =
    /(?<![\w-])(?:text|bg|border|fill|stroke)-(?:aura|success|green|emerald)[\w/-]*|\bgalleria\.(?:aura|success)\w*|\bsemantic\b|#2BD0D2|\bauraGlow\b|(?<![\w-])shadow-[\w/[\]-]+|<AuraValue\b/gi;

  it('the home folder is the nine files this section was written against', () => {
    expect(HOME_FOLDER).toEqual([
      'components/home/DreamHeroCard.tsx',
      'components/home/FavorNudgeCard.tsx',
      'components/home/HomeHeader.tsx',
      'components/home/InviteCard.tsx',
      'components/home/MomentiCard.tsx',
      'components/home/PrimeStelleCard.tsx',
      'components/home/StarsMiniRow.tsx',
      'components/home/TodaySection.tsx',
      'components/home/WeekSlot.tsx',
    ]);
  });

  it('the one cyan on Home is the dot of the waiting Momento', () => {
    const hits = HOME.flatMap((file) =>
      (code(file).match(CYAN_OR_GREEN) ?? []).map((hit) => `${file}  ${hit}`),
    );
    expect(hits, 'cyan is five marks (DESIGN §2.3); Home carries the first and no other').toEqual([
      `${MOMENTO}  bg-aura`,
    ]);
  });

  it('the one bordered card on Home is the waiting Momento', () => {
    const carded = HOME.filter((file) => /<Card\b/.test(code(file)));
    expect(carded, 'a screen has at most one bordered card (DESIGN §6)').toEqual([MOMENTO]);
    const bordered = HOME.filter((file) =>
      /(?<![\w-])border(?:-[\w/[\].-]+)?(?![\w-])/.test(code(file)),
    );
    expect(bordered, '`Card` brings the hairline; no Home file draws a border of its own').toEqual(
      [],
    );
  });

  it('a Home file sizes its text with a type class or a literal px, never a named size', () => {
    const NAMED_SIZE = /(?<![\w-])text-(?:xs|sm|base|lg|xl|[2-9]xl)\b/;
    const LEGACY_SHAPE =
      /(?<![\w-])(?:leading-[\w[\].-]+|tracking-[\w[\].-]+|uppercase\b|rounded-(?:card|hero|ctl|sm)\b|bg-raise(?:-2)?\b|text-faint\b)/;
    const hits = HOME.filter(
      (file) => NAMED_SIZE.test(code(file)) || LEGACY_SHAPE.test(code(file)),
    );
    expect(
      hits,
      'a named size resolves at a rem of 14 on device (`text-sm` is 12.25) and `leading-*` emits ' +
        'nothing (measured 2026-10-04, DESIGN §6 and §11)',
    ).toEqual([]);
  });

  it('no Home file types a close, and the one typed chevron is the fund line’s', () => {
    const typed = HOME.flatMap((file) =>
      [...code(file)].filter((ch) => '✕×‹›'.includes(ch)).map((ch) => `${file}  ${ch}`),
    );
    expect(
      typed,
      'the close is the drawn `HeaderClose`; a row’s chevron is `Row`’s; the fund line ends on a ' +
        '`›` that is part of its text, as the catalog’s «Scopri chi è ›» is',
    ).toEqual(['components/home/DreamHeroCard.tsx  ›']);
  });

  it('every pressable on Home dims when pressed', () => {
    const undimmed = HOME.flatMap((file) =>
      jsxOpeningTags(code(file))
        // `raw`, not `attrs`: the class sits inside `className={cn(…)}`, and `attrs` blanks braces.
        .filter(({ base, raw }) => base === 'Pressable' && !/\bPRESS_DIM\b/.test(raw))
        .map(({ line }) => `${file}:${line}`),
    );
    expect(undimmed, 'take `PRESS_DIM` from `@/lib/press`, unconditionally').toEqual([]);
  });

  it('the three header controls are 44pt boxes, not a glyph with hitSlop', () => {
    const header = code('components/home/HomeHeader.tsx');
    expect(header).not.toMatch(/\bhitSlop\b/);
    expect(header).toMatch(/min-h-\[44px\] min-w-\[44px\]/);
  });

  it('the stars and the invite are one group of rows', () => {
    const screen = code('app/(tabs)/index.tsx').replace(/\s+/g, ' ');
    expect(screen).toMatch(/<RowGroup> <StarsMiniRow\b[^]*?\/> <InviteCard\b[^]*?\/> <\/RowGroup>/);
  });
});

/*
 * The Community tab (#921, the third screen chunk). The prototype draws NO bordered card here:
 * each post is a borderless `surface` block of its own (Marco, 2026-10-05). Cyan stands once,
 * on «✦ Un passo del percorso» (DESIGN §2.3). The story ring and a lit star are foreground.
 * `live/EventRow` under the «Eventi» filter and `media/MediaFrame` are not in this list: they
 * convert with Athanor Live and with the feed modals.
 */
describe('the Community tab keeps the Galleria look (#921)', () => {
  const FEED_FOLDER = FILES.filter((p) => !isTest(p) && p.includes('/components/feed/'))
    .map((p) => rel(p).replace('apps/native/src/', ''))
    .sort();
  const RING = 'components/stories/StoryRing.tsx';
  const POST = 'components/feed/FeedPost.tsx';
  const MEDIA = 'components/feed/PostMedia.tsx';
  const SCREEN = 'app/(tabs)/community.tsx';
  const COMMUNITY = [SCREEN, ...FEED_FOLDER, 'components/stories/StoryRail.tsx', RING];
  const code = (file: string) => stripComments(read(`${SRC}${file}`));
  /** Cyan or green by class, token, literal or the old palette; a glow by helper or shadow. */
  const CYAN_OR_GREEN =
    /(?<![\w-])(?:text|bg|border|fill|stroke)-(?:aura|success|green|emerald)[\w/-]*|\bgalleria\.(?:aura|success)\w*|\bsemantic\b|#2BD0D2|\bauraGlow\b|(?<![\w-])shadow-[\w/[\]-]+|<AuraValue\b/gi;

  it('the feed folder is the eight files this section was written against', () => {
    expect(FEED_FOLDER).toEqual([
      'components/feed/CategoryTabs.tsx',
      'components/feed/Comment.tsx',
      'components/feed/EventsFeedList.tsx',
      'components/feed/FeedPost.tsx',
      'components/feed/FeedSkeleton.tsx',
      'components/feed/PostAuthorRow.tsx',
      'components/feed/PostMedia.tsx',
      'components/feed/ReactionStar.tsx',
    ]);
  });

  it('the one cyan on Community is «✦ Un passo del percorso»', () => {
    const hits = COMMUNITY.flatMap((file) =>
      (code(file).match(CYAN_OR_GREEN) ?? []).map((hit) => `${file}  ${hit}`),
    );
    expect(
      hits,
      'cyan is five marks (DESIGN §2.3); Community carries the third and no other',
    ).toEqual([`${POST}  text-aura`]);
    expect(code(POST), 'and it is on the step line').toMatch(
      /<Text className="type-label text-aura">✦ \{t\('feed\.flag\.step', locale\)\}<\/Text>/,
    );
  });

  it('Community has no bordered card', () => {
    const carded = COMMUNITY.filter((file) => /<Card\b/.test(code(file)));
    expect(carded, 'a post is a borderless block (DESIGN §8.3)').toEqual([]);
    const bordered = COMMUNITY.filter((file) =>
      /(?<![\w-])border(?:-[\w/[\].-]+)?(?![\w-])/.test(code(file)),
    );
    expect(
      bordered,
      'a hairline stands on a media tile and the audio pill, and on the story disc, its ring ' +
        'and its badge; nowhere else',
    ).toEqual([MEDIA, RING]);
  });

  it('a Community file sizes its text with a type class or a literal px, never a named size', () => {
    const NAMED_SIZE = /(?<![\w-])text-(?:xs|sm|base|lg|xl|[2-9]xl)\b/;
    const LEGACY_SHAPE =
      /(?<![\w-])(?:leading-[\w[\].-]+|tracking-[\w[\].-]+|uppercase\b|rounded-(?:card|hero|ctl|sm)\b|bg-raise(?:-2)?\b|bg-surface-muted\b|text-faint\b)|\bgalleria\.(?:faint|raise\w*|surfaceMuted|ink2)\b/;
    const hits = COMMUNITY.filter(
      (file) => NAMED_SIZE.test(code(file)) || LEGACY_SHAPE.test(code(file)),
    );
    expect(
      hits,
      'a named size resolves at a rem of 14 on device (`text-sm` is 12.25) and `leading-*` emits ' +
        'nothing (measured 2026-10-04, DESIGN §6 and §11)',
    ).toEqual([]);
  });

  it('no Community file types a control: the add is the drawn icon', () => {
    const typed = COMMUNITY.flatMap((file) => [
      ...[...code(file)].filter((ch) => '✕×‹›'.includes(ch)).map((ch) => `${file}  ${ch}`),
      ...(code(file).match(/>\s*\+\s*<|\{\s*['"`]\+['"`]\s*\}/g) ?? []).map(
        (hit) => `${file}  ${hit}`,
      ),
    ]);
    expect(typed, 'a typed `+`, `✕`, `×` or chevron as a control').toEqual([]);
    for (const file of [SCREEN, RING]) {
      expect(code(file), `${file} draws the add`).toMatch(/<AddIcon\b/);
    }
  });

  it('every pressable on Community dims when pressed', () => {
    const undimmed = COMMUNITY.flatMap((file) =>
      jsxOpeningTags(code(file))
        // `raw`, not `attrs`: the class sits inside `className={cn(…)}`, and `attrs` blanks braces.
        .filter(({ base, raw }) => base === 'Pressable' && !/\bPRESS_DIM\b/.test(raw))
        .map(({ line }) => `${file}:${line}`),
    );
    expect(undimmed, 'take `PRESS_DIM` from `@/lib/press`, unconditionally').toEqual([]);
  });

  it('the title is h1 and the filters are chips', () => {
    const screen = code(SCREEN);
    expect(screen, 'tab roots are h1 (DESIGN §6 «Screen headers»)').toMatch(
      /cn\('type-h1 text-foreground'/,
    );
    const tabs = code('components/feed/CategoryTabs.tsx');
    expect(tabs, 'DESIGN §9 «Tabs (feed)»').toMatch(/<Chip\b/);
    expect(tabs, 'no hand-rolled tab').not.toMatch(/<Pressable\b/);
  });

  it('a story to watch is a 2px foreground ring on a 56 disc', () => {
    const ring = code(RING);
    expect(ring).toMatch(/const DISC = 56;/);
    expect(ring, 'the ring').toMatch(/absolute inset-0 rounded-full border-2 border-foreground/);
    expect(ring, 'drawn only while unseen').toMatch(/\{seen \? null : \(/);
  });

  it('your own disc is the add only once it is known you have no live story', () => {
    const ring = code(RING);
    // `live` is `null` while the own-story read is out: the photo, neither add (Greptile, PR 936).
    expect(ring).toMatch(/const adds = isYou && live === false;/);
    expect(ring).toMatch(/\{isYou && live === true && onAddPress \? \(/);
    expect(code(SCREEN)).toMatch(/live: myStoryQuery\.isLoading \? null : myHasLive,/);
  });

  it('a comment with no action draws no action row', () => {
    expect(code('components/feed/Comment.tsx').replace(/\s+/g, ' ')).toMatch(
      /\{onReply \|\| onDelete \? \( <View className=\{cn\('flex-row gap-4'/,
    );
  });

  it('a lit star is foreground', () => {
    expect(code('components/feed/ReactionStar.tsx')).toMatch(
      /lit \? 'text-foreground' : 'text-muted-foreground'/,
    );
  });
});

/*
 * The Momenti and Costellazioni tabs (#921, the fifth screen chunk). Momenti's one bordered card
 * is the staging Momento; Costellazioni has none: the favour band is a `Row` and each project a
 * borderless `surface` block (Marco, 2026-10-05). Cyan stands once, on the dot beside «Hai un
 * Momento» (DESIGN §2.3). The swipe stamps are foreground and grey: no green, and passing is
 * not an error. `costellazioni/FavorRow` is not in this list: its one caller is the favour
 * sheet, and it converts with it.
 */
describe('the Momenti and Costellazioni tabs keep the Galleria look (#921)', () => {
  const folder = (name: string) =>
    FILES.filter((p) => !isTest(p) && p.includes(`/components/${name}/`))
      .map((p) => rel(p).replace('apps/native/src/', ''))
      .sort();
  const MOMENTI_FOLDER = folder('momenti');
  const COSTELLAZIONI_FOLDER = folder('costellazioni');
  const FAVOR = 'components/costellazioni/FavorRow.tsx';
  const MOMENTI = 'app/(tabs)/momenti.tsx';
  const COSTELLAZIONI = 'app/(tabs)/costellazioni.tsx';
  const CARD = 'components/momenti/MomentoCard.tsx';
  const STAMP = 'components/momenti/SwipeStamp.tsx';
  const TABS = [
    MOMENTI,
    COSTELLAZIONI,
    ...MOMENTI_FOLDER,
    ...COSTELLAZIONI_FOLDER.filter((file) => file !== FAVOR),
  ];
  const code = (file: string) => stripComments(read(`${SRC}${file}`));
  /** Cyan or green by class, token, literal or the old palette; a glow by helper or shadow. */
  const CYAN_OR_GREEN =
    /(?<![\w-])(?:text|bg|border|fill|stroke)-(?:aura|success|green|emerald)[\w/-]*|\bgalleria\.(?:aura|success)\w*|\bsemantic\b|#2BD0D2|\bauraGlow\b|(?<![\w-])shadow-[\w/[\]-]+|<AuraValue\b/gi;

  it('the two folders are the files this section was written against', () => {
    expect(MOMENTI_FOLDER).toEqual([
      'components/momenti/AffinityRow.tsx',
      'components/momenti/MomentoCard.tsx',
      'components/momenti/SuggestionRow.tsx',
      'components/momenti/SwipeDeck.tsx',
      'components/momenti/SwipeStamp.tsx',
    ]);
    expect(COSTELLAZIONI_FOLDER).toEqual([
      FAVOR,
      'components/costellazioni/ProjectCard.tsx',
      'components/costellazioni/ProjectFilterTabs.tsx',
    ]);
  });

  it('the one cyan on the two tabs is the dot of the waiting Momento', () => {
    const hits = TABS.flatMap((file) =>
      (code(file).match(CYAN_OR_GREEN) ?? []).map((hit) => `${file}  ${hit}`),
    );
    expect(
      hits,
      'cyan is five marks (DESIGN §2.3); Momenti carries the first, Costellazioni none',
    ).toEqual([`${MOMENTI}  bg-aura`]);
    expect(code(MOMENTI).replace(/\s+/g, ' '), 'and it stands beside «Hai un Momento»').toMatch(
      /\{hasMomento \? \( <View className="flex-row items-center gap-2"> <View className="h-2 w-2 rounded-full bg-aura" \/> <SectionLabel>\{t\('momenti\.eyebrow', locale\)\}<\/SectionLabel>/,
    );
  });

  it('the one bordered card is the staging Momento', () => {
    expect(code(CARD), 'the prototype’s `.card`: hairline, charcoal, 28, 20 inside').toMatch(
      /grow gap-\[14px\] overflow-hidden rounded-\[28px\] border border-hair bg-surface p-5/,
    );
    const bordered = TABS.filter((file) =>
      /(?<![\w-])border(?:-[\w/[\].-]+)?(?![\w-])/.test(code(file)),
    );
    expect(
      bordered,
      'a hairline stands on the Momento card, on its loading stand-in and the deck’s toast in ' +
        'the route, and on a swipe stamp; Costellazioni draws none (DESIGN §6, §8.9)',
    ).toEqual([MOMENTI, CARD, STAMP]);
    expect(
      TABS.filter((file) => /<Card\b/.test(code(file))),
      'the shared `Card` cannot fill the deck well; the Momento card writes its shape',
    ).toEqual([]);
  });

  it('a file of the two tabs sizes its text with a type class or a literal px', () => {
    const NAMED_SIZE = /(?<![\w-])text-(?:xs|sm|base|lg|xl|[2-9]xl)\b/;
    const LEGACY_SHAPE =
      /(?<![\w-])(?:leading-[\w[\].-]+|tracking-[\w[\].-]+|uppercase\b|rounded-(?:card|hero|ctl|sm|lg)\b|bg-raise(?:-2)?\b|bg-surface-muted\b|text-faint\b)|\bgalleria\.(?:faint|raise\w*|surfaceMuted|ink2)\b/;
    const hits = TABS.filter(
      (file) => NAMED_SIZE.test(code(file)) || LEGACY_SHAPE.test(code(file)),
    );
    expect(
      hits,
      'a named size resolves at a rem of 14 on device (`text-sm` is 12.25) and `leading-*` emits ' +
        'nothing (measured on the iPhone SE simulator, 2026-10-04; DESIGN §6 and §11)',
    ).toEqual([]);
  });

  it('no file of the two tabs types a control', () => {
    const typed = TABS.flatMap((file) => [
      ...[...code(file)].filter((ch) => '✕×‹›'.includes(ch)).map((ch) => `${file}  ${ch}`),
      ...(code(file).match(/>\s*\+\s*<|\{\s*['"`]\+['"`]\s*\}/g) ?? []).map(
        (hit) => `${file}  ${hit}`,
      ),
    ]);
    expect(typed, 'the favour band’s chevron is `Row`’s; «+ Pubblica» is a catalog label').toEqual(
      [],
    );
  });

  it('every pressable on the two tabs dims when pressed', () => {
    const undimmed = TABS.flatMap((file) =>
      jsxOpeningTags(code(file))
        // `raw`, not `attrs`: the class sits inside `className={cn(…)}`, and `attrs` blanks braces.
        .filter(({ base, raw }) => base === 'Pressable' && !/\bPRESS_DIM\b/.test(raw))
        .map(({ line }) => `${file}:${line}`),
    );
    expect(undimmed, 'take `PRESS_DIM` from `@/lib/press`, unconditionally').toEqual([]);
  });

  it('the deck well is a minimum: the top card can grow it', () => {
    // Measured 2026-10-05 on the iPhone SE simulator at AX5: three reasons in body text and a
    // three-line dream need 826pt, the well gives 760. A fixed height cut the dream's last line.
    expect(code(MOMENTI)).toMatch(/style=\{\{ minHeight: wellHeight \}\}/);
    expect(code(MOMENTI), 'no arm of the well is `flex-1`').not.toMatch(
      /className="flex-1 (?:rounded|justify-center|items-center)/,
    );
    const deck = code('components/momenti/SwipeDeck.tsx');
    expect(deck).toMatch(/<View className="grow">/);
    expect(deck).toMatch(/flexGrow: 1,/);
    expect(deck, 'the peek card takes the top card’s box').toMatch(
      /className="absolute inset-0 opacity-70"/,
    );
  });

  it('only the Costellazioni title may shrink to fit', () => {
    // DESIGN §10 forbids `adjustsFontSizeToFit` and names this one exception (Marco, 2026-10-05).
    const users = FILES.filter(
      (p) => !isTest(p) && /\badjustsFontSizeToFit\b/.test(stripComments(read(p))),
    ).map((p) => rel(p).replace('apps/native/src/', ''));
    expect(users).toEqual([COSTELLAZIONI]);
    expect(code(COSTELLAZIONI).replace(/\s+/g, ' ')).toMatch(
      /className="type-h1 text-foreground" numberOfLines=\{wordLines\(title\)\} adjustsFontSizeToFit/,
    );
  });

  it('both titles are h1', () => {
    for (const file of [MOMENTI, COSTELLAZIONI]) {
      expect(
        code(file).replace(/\s+/g, ' '),
        `${file}: tab roots are h1 (DESIGN §6 «Screen headers»)`,
      ).toMatch(/accessibilityRole="header" className="type-h1 text-foreground"/);
    }
  });

  it('the deck keeps its two pills: a swipe is never the only way to answer', () => {
    const screen = code(MOMENTI).replace(/\s+/g, ' ');
    expect(screen, 'the pills line up and wrap through `ButtonRow`').toMatch(/<ButtonRow>/);
    expect(screen, '«Passa» is the outline pill').toMatch(
      /<Button variant="outline" label=\{t\('momenti\.pass', locale\)\}[^>]*onPress=\{\(\) => deckRef\.current\?\.swipe\('left'\)\}/,
    );
    expect(screen, '«Connetti ✦» is the white pill, not the cyan one').toMatch(
      /<Button label=\{t\('momenti\.connect', locale\)\}[^>]*onPress=\{\(\) => deckRef\.current\?\.swipe\('right'\)\}/,
    );
    // The height the action row has until it is measured is the pill's own floor.
    expect(screen).toMatch(/const ACTION_ROW_FALLBACK = 50;/);
    expect(code('components/Button.tsx')).toMatch(/'min-h-\[50px\] rounded-full py-3'/);
  });

  it('a swipe stamp is foreground for yes and grey for no', () => {
    const stamp = code(STAMP);
    expect(stamp).toMatch(/isYes \? 'border-foreground' : 'border-muted-foreground'/);
    expect(stamp).toMatch(/isYes \? 'text-foreground' : 'text-muted-foreground'/);
    expect(stamp, 'passing is not an error').not.toMatch(/(?<![\w-])(?:text|border)-error\b/);
  });

  it('a reason’s tick is the reason’s own colour', () => {
    expect(code('components/momenti/AffinityRow.tsx')).toMatch(
      /<Text className="type-body text-foreground">✓ \{text\}<\/Text>/,
    );
  });

  it('a suggestion is a row of a group, and its tag goes under the text at the largest sizes', () => {
    const screen = code(MOMENTI).replace(/\s+/g, ' ');
    expect(screen).toMatch(/<RowGroup> \{suggestions\.data\.map\(/);
    const row = code('components/momenti/SuggestionRow.tsx');
    expect(row, 'the row is `Row`, the disc in its leading slot').toMatch(/<Row\s+leading=\{/);
    expect(row, 'no row of its own').not.toMatch(/<Pressable\b|min-h-15/);
    expect(row).toMatch(/const stacked = stacksTrailing\(useWindowDimensions\(\)\.fontScale\);/);
    expect(row, 'the tag’s 40% cap holds only beside the text').toMatch(
      /trailing=\{<Tag shrink=\{!stacked\} quiet label=\{reason\} \/>\}/,
    );
  });

  it('Costellazioni: the favour band is a row, the publish a small outline pill, the filters chips', () => {
    const screen = code(COSTELLAZIONI).replace(/\s+/g, ' ');
    expect(screen).toMatch(
      /<RowGroup> <Row title=\{t\('costellazioni\.favor\.title', locale\)\} description=\{t\('costellazioni\.favor\.desc', locale\)\} onPress=\{\(\) => router\.push\(FAVOR_HREF\)\} \/> <\/RowGroup>/,
    );
    expect(screen).toMatch(
      /<Button variant="outline" size="sm" label=\{t\('costellazioni\.publish', locale\)\}/,
    );
    const tabs = code('components/costellazioni/ProjectFilterTabs.tsx');
    expect(tabs).toMatch(/<Chip\b/);
    expect(tabs, 'no hand-rolled tab').not.toMatch(/<Pressable\b/);
    expect(tabs, 'a selected chip that is off screen is brought back').toMatch(/scrollTo\(/);
    expect(tabs, 'the chips’ `hitSlop` stays inside the row').toMatch(/px-5 py-1\.5/);
  });

  it('a project is a borderless block whose author line is small and grey', () => {
    const card = code('components/costellazioni/ProjectCard.tsx').replace(/\s+/g, ' ');
    expect(card, 'the prototype’s `.rows > .row.col`').toMatch(
      /<RowGroup> <View className="gap-\[10px\] py-\[14px\]">/,
    );
    expect(card, 'pitch over person (DESIGN §8.9)').toMatch(
      /className="shrink type-small text-muted-foreground"/,
    );
    expect(card, 'the shared author row is 17/500: not here').not.toMatch(/<PostAuthorRow\b/);
  });
});

/**
 * The Profilo tab (#921, C13): the route, `components/profile/`, and the three components only
 * the profile renders (`aura/StarProgress`, `media/MomentiGallery`, and `ProfileBody` through
 * which the other member's profile draws the same hero, Aura block, dream and stars).
 */
describe('the Profilo tab keeps the Galleria look (#921)', () => {
  const PROFILE_FOLDER = FILES.filter((p) => !isTest(p) && p.includes('/components/profile/'))
    .map((p) => rel(p).replace('apps/native/src/', ''))
    .sort();
  const TAB = 'app/(tabs)/profile.tsx';
  const HERO = 'components/profile/ProfileHero.tsx';
  const AURA = 'components/profile/AuraBlock.tsx';
  const DREAM = 'components/profile/DreamCard.tsx';
  const TAPPA = 'components/profile/MilestoneRow.tsx';
  const OFFER = 'components/profile/IncomingOfferRow.tsx';
  const FLASH = 'components/profile/MomentFlash.tsx';
  const STARS = 'components/profile/SixStarsGrid.tsx';
  const EDITOR = 'components/profile/ProfileEditForm.tsx';
  const SECTION = 'components/profile/Section.tsx';
  const NEXT_STAR = 'components/aura/StarProgress.tsx';
  const GALLERY = 'components/media/MomentiGallery.tsx';
  const PROFILE = [TAB, ...PROFILE_FOLDER, NEXT_STAR, GALLERY];
  const code = (file: string) => stripComments(read(`${SRC}${file}`));
  const flat = (file: string) => code(file).replace(/\s+/g, ' ');
  /** Cyan or green by class, token, literal or the old palette; a glow by helper or shadow. */
  const CYAN_OR_GREEN =
    /(?<![\w-])(?:text|bg|border|fill|stroke)-(?:aura|success|green|emerald)[\w/-]*|\bgalleria\.(?:aura|success)\w*|\bsemantic\b|#2BD0D2|\bauraGlow\b|(?<![\w-])shadow-[\w/[\]-]+|<AuraValue\b/gi;

  it('the folder is the files this section was written against', () => {
    expect(PROFILE_FOLDER).toEqual([
      AURA,
      'components/profile/CityPicker.tsx',
      DREAM,
      'components/profile/DreamSection.tsx',
      'components/profile/FoundingBadge.tsx',
      'components/profile/HandleField.tsx',
      OFFER,
      TAPPA,
      FLASH,
      'components/profile/ProfileBody.tsx',
      EDITOR,
      HERO,
      'components/profile/ProfileView.tsx',
      SECTION,
      STARS,
      'components/profile/ZodiacMark.tsx',
    ]);
  });

  it('the one cyan on the profile is the member’s own Aura numeral', () => {
    const hits = PROFILE.flatMap((file) =>
      (code(file).match(CYAN_OR_GREEN) ?? []).map((hit) => `${file}  ${hit}`),
    );
    expect(
      hits,
      'cyan is five marks (DESIGN §2.3); the profile carries the second, and no green, no glow',
    ).toEqual([`${AURA}  text-aura`]);
    expect(code(AURA), 'cyan on the own profile, foreground on another member’s').toMatch(
      /own \? 'text-aura' : 'text-foreground'/,
    );
  });

  it('nothing on the profile stands for the Aura tier', () => {
    // Ruling 5 (Marco, 2026-10-03): no mandorla frame, no glow.
    expect(code(HERO)).not.toMatch(/Mandorla/);
    expect(code(FLASH)).not.toMatch(/glow/i);
  });

  it('the one bordered card is the dream, and it holds the label and the quote', () => {
    expect(
      PROFILE.filter((file) => /<Card\b/.test(code(file))),
      'tappe, offers, stars and the editor’s sections are groups or bare blocks (DESIGN §6)',
    ).toEqual([DREAM]);
    expect(
      PROFILE.filter((file) => /(?<![\w-])border(?:-[\w/[\].-]+)?(?![\w-])/.test(code(file))),
      'a hairline is typed on the «Aiuta» pill shape and on the flash; the card’s is `Card`’s',
    ).toEqual([TAPPA, FLASH]);
    const card = flat(DREAM);
    expect(card, 'the tappe stand outside the card, in a group').toMatch(
      /<\/Card> \{showTappe \? \( <RowGroup label=\{t\('milestone\.sectionLabel', locale\)\}>/,
    );
  });

  it('a file of the profile sizes its text with a type class or a literal px', () => {
    const NAMED_SIZE = /(?<![\w-])text-(?:xs|sm|base|lg|xl|[2-9]xl)\b/;
    const LEGACY_SHAPE =
      /(?<![\w-])(?:leading-[\w[\].-]+|tracking-[\w[\].-]+|uppercase\b|rounded-(?:card|hero|ctl|sm|lg)\b|bg-raise(?:-2)?\b|bg-surface-muted\b|text-faint\b|text-ink-2\b)|\bgalleria\.(?:faint|raise\w*|surfaceMuted|ink2)\b/;
    expect(
      PROFILE.filter((file) => NAMED_SIZE.test(code(file)) || LEGACY_SHAPE.test(code(file))),
      'a named size resolves at a rem of 14 on device (`text-sm` is 12.25) and `leading-*` emits ' +
        'nothing (measured on the iPhone SE simulator, 2026-10-04; DESIGN §6 and §11)',
    ).toEqual([]);
  });

  it('no file of the profile types a control', () => {
    const typed = PROFILE.flatMap((file) => [
      ...[...code(file)].filter((ch) => '✕×‹›＋⋯'.includes(ch)).map((ch) => `${file}  ${ch}`),
      ...(code(file).match(/>\s*\+\s*<|\{\s*['"`]\+['"`]\s*\}/g) ?? []).map(
        (hit) => `${file}  ${hit}`,
      ),
    ]);
    expect(typed, 'share, add and more are drawings; a chevron is `Row`’s').toEqual([]);
  });

  it('every pressable on the profile dims when pressed', () => {
    const undimmed = PROFILE.flatMap((file) =>
      jsxOpeningTags(code(file))
        // `raw`, not `attrs`: the class sits inside `className={cn(…)}`, and `attrs` blanks braces.
        .filter(({ base, raw }) => base === 'Pressable' && !/\bPRESS_DIM\b/.test(raw))
        .map(({ line }) => `${file}:${line}`),
    );
    expect(undimmed, 'take `PRESS_DIM` from `@/lib/press`, unconditionally').toEqual([]);
  });

  it('the header is two drawn icons and a small outline pill, and «saved» is the shared toast', () => {
    const tab = flat(TAB);
    expect(tab, 'share is the drawn icon, not a cyan ✦').toMatch(/<ShareIcon\b/);
    expect(tab).toMatch(
      /<Button variant="outline" size="sm" label=\{t\('profile\.edit', locale\)\}/,
    );
    expect(tab, 'no green line under the profile (ruling 7)').not.toMatch(/\bsetSaved\b/);
    expect(tab).toMatch(/showToast\(t\('profile\.saved', locale\)/);
  });

  it('the hero is a row that stacks at the largest sizes, in screen order', () => {
    const hero = flat(HERO);
    expect(hero).toMatch(/const stacked = stacksTrailing\(useWindowDimensions\(\)\.fontScale\);/);
    expect(hero).toMatch(/stacked \? 'gap-4' : 'flex-row items-center gap-4'/);
    expect(hero, 'no reversed order in either layout').not.toMatch(/-reverse\b/);
    expect(hero, 'the name is the pushed-header size').toMatch(/shrink type-title text-foreground/);
  });

  it('the six stars are rows of one group, and no grid cell is left', () => {
    const stars = code(STARS);
    expect(stars).toMatch(/<RowGroup\b/);
    expect(stars).toMatch(/<Row\b/);
    expect(
      stars.replace(/\s+/g, ' '),
      'a `Row` without `onPress` takes no label: an inert star is one labelled element',
    ).toMatch(/<View key=\{key\} accessible accessibilityLabel=\{label\}> <Row title=\{title\}/);
    expect(
      FILES.filter((p) => /\bStarCell\b/.test(stripComments(read(p)))).map(rel),
      '`aura/StarCell` had one caller, the grid',
    ).toEqual([]);
  });

  it('the other member’s profile spaces the shared blocks as the tab does', () => {
    // `ProfileHero` and `DreamCard` return their blocks side by side: the caller's gap is
    // what stands between them, so both callers set the screen's 26.
    for (const file of [TAB, 'app/(modal)/user/[id].tsx']) {
      expect(code(file), file).toMatch(/contentContainerClassName="gap-\[26px\] px-5 pb-12/);
    }
  });

  it('an incoming offer is a block of the «Aiuti in arrivo» group with two small pills', () => {
    expect(flat('components/profile/DreamSection.tsx')).toMatch(
      /<RowGroup label=\{t\('help\.owner\.sectionLabel', locale\)\}>/,
    );
    const offer = flat(OFFER);
    expect(offer, 'the prototype’s `.rows > .row.col`').toMatch(/gap-\[10px\] py-\[14px\]/);
    expect(offer).toMatch(
      /<ButtonRow> <Button size="sm" label=\{t\('help\.owner\.accept', locale\)\}[^>]*\/> <Button variant="outline" size="sm" label=\{t\('help\.owner\.decline', locale\)\}/,
    );
  });

  it('a tappa keeps its own row: the whole row offers help, the pill is a shape', () => {
    const row = code(TAPPA);
    expect(row, 'row geometry inside the group').toMatch(/min-h-15 flex-row gap-3 py-2/);
    expect(row, 'a done tappa’s tick is foreground').not.toMatch(/line-through/);
    expect(row, 'the kebab is the drawn icon').toMatch(/<MoreIcon\b/);
  });

  it('the editor’s sections stand on the stage, and its second action is the outline pill', () => {
    expect(code(SECTION), 'no card: a field in a card would need the black well').not.toMatch(
      /\bCard\b/,
    );
    expect(flat(EDITOR)).toMatch(
      /<Button variant="outline" label=\{t\('profile\.cancel', locale\)\}/,
    );
    expect(
      code('components/profile/CityPicker.tsx'),
      'the list answers typing, not the stored city: nothing is looked up until the field changes',
    ).toMatch(/if \(!edited\.current\) return;/);
  });

  it('the gallery’s «see all» is a 44pt underlined link beside its label', () => {
    const gallery = flat(GALLERY);
    expect(gallery).toMatch(
      /stacked \? 'items-start gap-2' : 'flex-row items-center justify-between gap-3'/,
    );
    expect(gallery).toMatch(/type-small text-foreground underline/);
  });
});

describe('search and notifications keep the Galleria look (#921)', () => {
  const SEARCH_FOLDER = FILES.filter((p) => !isTest(p) && p.includes('/components/search/'))
    .map((p) => rel(p).replace('apps/native/src/', ''))
    .sort();
  const SEARCH = 'app/(modal)/search.tsx';
  const FILTERS = 'app/(modal)/search-filters.tsx';
  const NOTIFS = 'app/(modal)/notifications.tsx';
  const BAR = 'components/search/SearchBar.tsx';
  const SCOPES = 'components/search/ScopeTabs.tsx';
  const RESULT = 'components/search/ResultRow.tsx';
  const NOTIF_ROW = 'components/trust/NotificationRow.tsx';
  const NOTIF_TYPES = 'components/trust/notifTypes.ts';
  const ALL = [SEARCH, FILTERS, NOTIFS, ...SEARCH_FOLDER, NOTIF_ROW, NOTIF_TYPES];
  const code = (file: string) => stripComments(read(`${SRC}${file}`));
  const flat = (file: string) => code(file).replace(/\s+/g, ' ');
  /** Cyan or green by class, token, literal or the old palette; a glow by helper or shadow. */
  const CYAN_OR_GREEN =
    /(?<![\w-])(?:text|bg|border|fill|stroke)-(?:aura|success|green|emerald)[\w/-]*|\bgalleria\.(?:aura|success)\w*|\bsemantic\b|#2BD0D2|\bauraGlow\b|(?<![\w-])shadow-[\w/[\]-]+|<AuraValue\b/gi;

  it('the folder is the files this section was written against', () => {
    expect(SEARCH_FOLDER).toEqual([RESULT, SCOPES, BAR]);
  });

  it('the one cyan is the dot on a waiting Momento’s row', () => {
    const hits = ALL.flatMap((file) =>
      (code(file).match(CYAN_OR_GREEN) ?? []).map((hit) => `${file}  ${hit}`),
    );
    expect(
      hits,
      'cyan is five marks (DESIGN §2.3); a matched word, a filter set, a chip and an unread ' +
        'row are foreground or grey',
    ).toEqual([`${NOTIF_ROW}  bg-aura`]);
    expect(flat(NOTIF_ROW), 'unread and a Momento: read, it takes the disc like any row').toMatch(
      /const waiting = item\.type === 'moment' && item\.read_at == null;/,
    );
  });

  it('none of the three screens has a bordered card', () => {
    expect(ALL.filter((file) => /<Card\b/.test(code(file)))).toEqual([]);
    expect(
      ALL.filter((file) => /(?<![\w-])border(?:-[\w/[\].-]+)?(?![\w-])/.test(code(file))),
      'a border is typed on the search field (focus) and on the two leading discs',
    ).toEqual([RESULT, BAR, NOTIF_ROW]);
  });

  it('a file of these screens sizes its text with a type class or a literal px', () => {
    const NAMED_SIZE = /(?<![\w-])text-(?:xs|sm|base|lg|xl|[2-9]xl)\b/;
    const LEGACY_SHAPE =
      /(?<![\w-])(?:leading-[\w[\].-]+|tracking-[\w[\].-]+|uppercase\b|rounded-(?:card|hero|ctl|sm|lg)\b|bg-raise(?:-2)?\b|bg-surface-muted\b|text-faint\b|text-ink-2\b)|\bgalleria\.(?:faint|raise\w*|surfaceMuted|ink2)\b/;
    expect(
      ALL.filter((file) => NAMED_SIZE.test(code(file)) || LEGACY_SHAPE.test(code(file))),
      'a named size resolves at a rem of 14 on device (`text-sm` is 12.25) and `leading-*` emits ' +
        'nothing (measured on the iPhone SE simulator, 2026-10-04; DESIGN §6 and §11)',
    ).toEqual([]);
  });

  it('no file of these screens types a control', () => {
    const typed = ALL.flatMap((file) =>
      [...code(file)].filter((ch) => '✕×‹›＋⋯'.includes(ch)).map((ch) => `${file}  ${ch}`),
    );
    expect(typed, 'close and clear are the drawn icon; a chevron is `Row`’s').toEqual([]);
  });

  it('every pressable on these screens dims when pressed', () => {
    const undimmed = ALL.flatMap((file) =>
      jsxOpeningTags(code(file))
        // `raw`, not `attrs`: the class sits inside `className={cn(…)}`, and `attrs` blanks braces.
        .filter(({ base, raw }) => base === 'Pressable' && !/\bPRESS_DIM\b/.test(raw))
        .map(({ line }) => `${file}:${line}`),
    );
    expect(undimmed, 'take `PRESS_DIM` from `@/lib/press`, unconditionally').toEqual([]);
  });

  it('the scopes are chips, and the filters opener is the small outline pill', () => {
    expect(code(SCOPES), 'the last underlined tab row').toMatch(/<Chip\b/);
    expect(code(SCOPES)).not.toMatch(/<Pressable\b/);
    expect(flat(SEARCH)).toMatch(
      /<Button variant="outline" size="sm" label=\{t\('search\.filters\.open', locale\)\}/,
    );
  });

  it('the search field keeps its clear control mounted', () => {
    // Mounted on the first character it lost typed characters (iPhone SE simulator,
    // 2026-10-06; `SearchBar`'s docblock has the counts).
    const bar = flat(BAR);
    expect(bar).toMatch(/disabled=\{!hasClearButton\}/);
    expect(bar, 'hidden, not unmounted').not.toMatch(/hasClearButton \? \(/);
    expect(bar, 'a `TextInput` takes physical padding (section 40)').toMatch(
      /className="flex-1 pb-3 pr-4 pt-3 text-\[17px\] text-foreground"/,
    );
  });

  it('a result is a row of its section’s group, and only its grey line marks the match', () => {
    const row = flat(RESULT);
    expect(row).toMatch(/<Row leading=\{/);
    expect(row, 'the row says what `searchRowLabel` says').toMatch(
      /accessibilityLabel=\{searchRowLabel\(result\)\}/,
    );
    expect(row, 'the title is the row’s own: all foreground').toMatch(/title=\{result\.title\}/);
    expect(row, 'a matched span of the second line is foreground on grey').toMatch(
      /span\.match \? 'text-foreground' : undefined/,
    );
    expect(flat(SEARCH)).toMatch(/<SectionLabel heading>.*?<\/SectionLabel> <RowGroup>/);
  });

  it('the filters close on the drawn icon and reset on an outline pill', () => {
    const filters = flat(FILTERS);
    expect(filters).toMatch(/<HeaderClose\b/);
    expect(filters).toMatch(/<Button label=\{t\('common\.reset', locale\)\} variant="outline"/);
    expect(filters, 'blocks 26 apart').toMatch(/contentContainerClassName="[^"]*gap-\[26px\]/);
  });

  it('a notification is a row of «Nuove» or «Prima», with no chevron and no unread dot', () => {
    const row = flat(NOTIF_ROW);
    expect(row).toMatch(/<Row leading=\{/);
    expect(row, 'the prototype draws no chevron on a notification').toMatch(
      /showChevron=\{false\}/,
    );
    expect(row, 'the action is a tag: the row is the control').toMatch(/trailing=\{/);
    expect(row).toMatch(/<Tag label=\{t\('notif\.action\.openMoment', locale\)\}/);
    expect(flat(NOTIFS)).toMatch(/<SectionLabel heading>.*?<\/SectionLabel> <RowGroup>/);
    expect(code(NOTIF_TYPES), 'a type has a glyph and nothing else to draw').not.toMatch(
      /accentClass|celebratory/,
    );
  });
});
