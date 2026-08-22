import { readFileSync, readdirSync, statSync } from 'node:fs';
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

  it('reads only EXPO_PUBLIC_* names, all declared in .env.example', () => {
    // Anything not prefixed EXPO_PUBLIC_ is stripped from the bundle by Expo, so it is
    // always `undefined` at runtime — and if it were NOT stripped it would be a secret leak.
    const example = readFileSync(`${NATIVE}.env.example`, 'utf8');
    const declared = new Set(
      [...example.matchAll(/^[ \t]*([A-Z0-9_]+)\s*=/gm)].map((m) => m[1] as string),
    );

    const reads = [...codeLines(), ...configLines()].flatMap(([where, t]) =>
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

// ---------------------------------------------------------------------------------------
// 8 — keyboard avoidance goes through the one wrapper (#163)
// ---------------------------------------------------------------------------------------

/**
 * Five composers had each copied `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`
 * — overshooting inside an iOS sheet (no measured offset) and inert on Android, where an
 * undefined behavior disables the component entirely. The fix is the one measured wrapper,
 * `components/KeyboardAvoiding.tsx`. StoriesViewer keeps a local copy because its chrome is
 * an absolute overlay rather than a flex column, but it must still branch to a real Android
 * behavior — which the second assertion checks for every file, allowlisted or not.
 */
describe('keyboard avoidance goes through the one wrapper (#163)', () => {
  const ALLOWED = ['components/KeyboardAvoiding.tsx', 'components/stories/StoriesViewer.tsx'];

  it('KeyboardAvoidingView is referenced only in the wrapper and the stories overlay', () => {
    const users = FILES.filter((p) => !isTest(p))
      .filter((p) => stripComments(read(p)).includes('KeyboardAvoidingView'))
      .map((p) => rel(p).replace('apps/native/src/', ''))
      .sort();
    expect(users).toEqual([...ALLOWED].sort());
  });

  it('no Android-inert keyboard behavior (a `: undefined` branch) anywhere', () => {
    // Comment-stripped: the wrapper's own docblock quotes the forbidden pattern to explain it.
    const hits = CODE_LINES.flatMap(([p, stripped]) =>
      stripped
        .map((text, i) => [`${rel(p)}:${i + 1}`, text] as const)
        .filter(([, t]) => /behavior=\{[^}]*\?\s*'padding'\s*:\s*undefined\}/.test(t))
        .map(([where]) => where),
    );
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 9 — a screen that HOLDS a picked video must be able to draw it (#318, #460)
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
 */
describe('a held picked video never draws through <Image> (#318, #460)', () => {
  const HOLDERS = FILES.filter((p) => !isTest(p)).filter((p) =>
    /useState<[^>]*PickedMedia/.test(stripComments(read(p))),
  );

  it('every composer that holds a pick names the no-poster surface', () => {
    expect(HOLDERS.length, 'no composer holds PickedMedia — has the state moved?').toBeGreaterThan(
      0,
    );
    const missing = HOLDERS.filter((p) => !read(p).includes("'media.noPoster.video'")).map(rel);
    expect(missing, 'a held video draws nothing — give it the no-poster fill + label').toEqual([]);
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
 * `eslint-config-expo/flat` plus an `ignores` block and nothing else, so
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
 * `deviceLocale` stays legal in exactly the places that have no profile to read: the funnel
 * and the boot screens that draw before (or instead of) a session, the draft store, and the
 * two hooks. Anywhere else it means a signed-in screen went around the hook.
 */
describe('the signed-in locale is resolved in exactly one place (#331)', () => {
  const RESOLVER = 'hooks/use-locale.ts';

  /** No profile exists yet (or at all) on these, so they read the device directly. */
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
 * The fix is a primitive (`Input` for the pill, `Field` for the hero-radius block), and both omit
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
        'placeholderTextColor={semantic.foregroundMuted} (#499)',
    ).toEqual([]);
  });

  /**
   * The primitive is the reason the list above stays short, so the ways in are pinned by name.
   * A newly hand-rolled hero-radius field is the regression this catches: it would satisfy the
   * assertion above just by pasting the prop, which is exactly the drift #499 removed.
   *
   * Matched on the ELEMENT's own attributes, not on the file — a file-level match would also
   * name every screen that merely wraps something in a `rounded-hero` container.
   *
   * The three compose screens are the rest of this family — same `rounded-hero border border-hair
   * bg-raise` shape — and they are deliberately NOT routed through `Field` yet. #499 defined its
   * twelve as the fields missing `placeholderTextColor`, and these three already pass it; folding
   * them in would change padding (`p-4` → `px-5 py-4`), type (15pt → 18pt) and height (arbitrary
   * `min-h-[80px]`/`[120px]`) on three screens no issue has asked for, and would widen the size
   * taxonomy from three spellings to five — a design decision to take deliberately, not as a side
   * effect of a placeholder fix. Listed so the next reader inherits the reason, not the mystery.
   */
  const HERO_NOT_YET_ROUTED = [
    'app/(modal)/post-compose.tsx',
    'app/(modal)/project-compose.tsx',
    'app/(modal)/story-compose.tsx',
  ];

  it('the hero-radius block field exists in exactly one place', () => {
    const users = [
      ...new Set(
        textInputs()
          .filter(([, attrs]) => /\brounded-hero\b/.test(attrs))
          .map(([at]) => at.replace('apps/native/src/', '').replace(/:\d+$/, '')),
      ),
    ].sort();
    expect(
      users,
      'a hero-radius text field has been hand-rolled again — use the Field primitive (#499)',
    ).toEqual([...HERO_NOT_YET_ROUTED, 'components/Field.tsx'].sort());
  });
});
