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
 * The mechanism is now `hooks/use-keyboard-inset.ts`: it measures inside the keyboard event
 * and pads. `KeyboardAvoidingView` is therefore gone from the app — the first assertion pins
 * its ABSENCE, not an allowlist, because a call site reaching for it again is the regression
 * this section exists to catch. The second keeps the old copied branch out even so, since a
 * reintroduction would most likely arrive in that shape. The third pins the new single point
 * of truth: nothing else subscribes to keyboard show/hide, so nobody hand-rolls avoidance at
 * a call site again.
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
   * The list carries NO exceptions, and keeping it that way is the whole of #504. The three
   * compose screens — story, post, project — were the rest of this family and sat here in a
   * `HERO_NOT_YET_ROUTED` array, because #499 had defined its twelve as the fields MISSING
   * `placeholderTextColor` and these three already passed it. Marco's ruling (2026-08-30) folded
   * them in, so the assertion below now says what its own title always claimed.
   *
   * The exception array is gone rather than emptied: an empty list is an invitation to append to,
   * and the next hand-rolled field should have nowhere to be written down.
   */
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
    ).toEqual(['components/Field.tsx']);
  });
});

// ---------------------------------------------------------------------------------------
// 16 — the upload transport is a single seam (#450)
// ---------------------------------------------------------------------------------------

/**
 * On iOS, `xhr.send({ uri })` does not stream: `RCTNetworkTask.mm` appends the whole file into
 * an `NSMutableData` and `RCTNetworking.mm` assigns it as `HTTPBody`, so a picked video becomes
 * one contiguous native allocation before the request leaves. That is #450, and it was
 * DEFERRED rather than fixed — blocked on #508's SDK 54 pin, because the replacement
 * (`expo/fetch`, or a native uploader) is not reachable from App Store Expo Go today.
 *
 * The deferral is only safe because the eventual swap is one module: `XMLHttpRequest` is
 * constructed in exactly one file, so however many upload surfaces get built on top of
 * `uploadWithProgress`, none of them adds a second place to fix. That property was true by
 * luck. This makes it true by assertion — a second `new XMLHttpRequest()` anywhere in the tree
 * silently doubles the cost of #450, and nothing else would say so.
 *
 * Comments are stripped first: `upload-transport.ts` names the type in prose, and #450's own
 * reasoning is the kind of thing a future docblock will quote.
 */
describe('the upload transport is a single seam (#450)', () => {
  const TRANSPORT = 'lib/media/upload-transport.ts';

  it('XMLHttpRequest is used in exactly one file, and it is the transport', () => {
    const users = [
      ...new Set(
        codeLines()
          .filter(([, text]) => /\bXMLHttpRequest\b/.test(text))
          .map(([at]) => at.replace('apps/native/src/', '').replace(/:\d+$/, '')),
      ),
    ].sort();
    expect(
      users,
      'XMLHttpRequest has escaped the transport — #450 (iOS buffers the whole body in native ' +
        'memory) is deferred on the promise that its fix is one module. Route the upload ' +
        `through ${TRANSPORT} instead.`,
    ).toEqual([TRANSPORT]);
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
 * `Pressable` defaults `accessible={true}` (`react-native@0.81.5`, `Pressable.js:245`), and on
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
 * pass over two real instances. `PermissionPrimer.tsx` nested a LABELLED «Non ora» button two
 * Pressables deep inside a scrim and a sheet that declare no role; both were still `accessible`,
 * so iOS swallowed the descendant anyway — and `MediaSheet.tsx` had the same pair. The mechanism
 * is `accessible`, which `Pressable` sets for you, and #292's note
 * (`components/media/MomentTile.tsx:58`) says so in as many words: "anything `accessible` nested
 * inside it". Keying on the role would have made this guard agree with the bug.
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
 * It held `PermissionPrimer.tsx` and `MediaSheet.tsx` — real instances deferred with an
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
 * (`ViewAccessibility.d.ts:300-303`), which is precisely the flag being turned off. So the exit
 * has to be a real element, and nothing checked that one existed.
 *
 * ## What counts as an exit
 *
 * The close callback is whatever a silenced `Pressable` passes as `onPress` — `onClose` in
 * `MediaSheet`, `onDismiss` in `PermissionPrimer`. An exit is any element that is NOT itself
 * silenced and fires that same callback. Keyed on the callback rather than on
 * `accessibilityRole="button"` because the two live sheets spell their exit differently and
 * both are correct: `PermissionPrimer` uses a bare `Pressable` with the role on it, while
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
 * `MediaSheet.tsx:222-227` argues this in place, and nothing enforced it: the cancel row is
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
    // components/media/MediaSheet.tsx and components/media/PermissionPrimer.tsx.
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
        `shape) or an accessible dismiss (components/media/PermissionPrimer.tsx). ` +
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
 * `AuthGuard` only ever `replace`s (`src/app/_layout.tsx:62,71,74`); `[handle].tsx:52`
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
 * affordance at all, and `(auth)/welcome.tsx:185` already renders its own conditionally.
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
      'a ModalHeader that renders a chevron or a ✕ with no accessibilityLabel. Since #578 the ' +
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
 * and RN falls back to its own default — black text, no border colour — on a `#0a0a1a`
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

/**
 * Two halves of the VoiceOver wave that a walk can actually see. The rest of #635 — a composed
 * label, a `checked` state, the peek card leaving the a11y tree — is per-site judgement no regex
 * can hold. These two are mechanical, and both regressed silently before.
 *
 * ## A bare `Switch` is an unnamed control
 *
 * React Native gives `Switch` its role and its checked state from `value`, and NOTHING else. The
 * label `Text` beside it in the row is a sibling, not an association — there is no `htmlFor`
 * here — so a `Switch` with no `accessibilityLabel` announces as «attivato, interruttore» with
 * no subject. Eleven of them shipped that way across `trust.tsx` and `notif-prefs.tsx`, which is
 * every switch the app has.
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
  const SWITCH_FILES = ['app/(modal)/trust.tsx', 'app/(modal)/notif-prefs.tsx'];
  const ANNOUNCE = /AccessibilityInfo\.announceForAccessibility\(/;

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

  it('finds the Switch sites it is walking', () => {
    const total = FILES.filter((p) => !isTest(p)).reduce(
      (n, p) => n + openingTags(stripComments(read(p)), 'Switch').length,
      0,
    );
    // A scanner that finds nothing passes every assertion below. Two files, six tags today.
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
        `RN derives the role and the checked state from \`value\`, and nothing else — the label ` +
        `Text beside it is an unassociated sibling, so this toggle announces with no subject. ` +
        `Pass accessibilityLabel with the SAME key the visible label renders, so the two ` +
        `cannot drift (#635).`,
    ).toEqual([]);
  });

  it('the Switch sites are exactly the two screens this section names', () => {
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
 * ## `h-11` is 44 on web and 38.5 on device
 *
 * `react-native-css` inlines `rem` at **14** unless the stylesheet declares a `:root`
 * font-size or metro passes `inlineRem`, and `apps/native` does neither (DESIGN §11,
 * 2026-08-30). So a spacing step is 3.5px, not 4, and the eleven-step utilities that read as
 * «44» are 38.5pt where it counts. Eleven sites shipped that way — one of them under a comment
 * that claimed «a real 44pt tap target» — because `getBoundingClientRect` in the expo-web walk
 * returns 44 for every one of them. The arbitrary form `h-[44px]` is a literal on both
 * platforms, which is why `Input.tsx:153-161` reaches for `style={{ width: 44 }}` and says so.
 *
 * The ban is on the CLASS, not on a measurement: eleven steps is only ever an attempt at the
 * floor, so there is no legitimate `h-11` to carve out. A genuine 38.5pt box would be written
 * as one.
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
 * (`StoryRing.tsx:65` wraps a 60pt avatar, `DreamCard.tsx:128` a whole row) — a guard whose
 * allowlist would be longer than its findings is a pin on today's tree, not an invariant.
 * §28 makes the same call in as many words for the rest of #635.
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
    'components/profile/DreamCard.tsx:74':
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
        `A spacing step is 3.5px on device (rem inlines at 14 — DESIGN §11, 2026-08-30), so ` +
        `this measures 38.5pt there while returning a passing 44px to the web walk. Write the ` +
        `literal \`h-[44px]\`/\`w-[44px]\`, or \`min-h-[44px]\` where the box grows (#638).`,
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
