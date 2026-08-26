import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gradient, semantic } from '@athanor/config';
import { describe, expect, it } from 'vitest';

/**
 * `app/globals.css` must mirror `packages/config/src/tokens.ts` — its own header says so
 * ("values mirror packages/config/src/tokens.ts. Update both together"), and until #61 only
 * `apps/native` had a test that made the claim true. Web went by review alone: `9c00237`
 * added `--color-aura-soft` / `--color-aura-line` and stayed in sync only because a human
 * reviewer noticed, which is the argument for this file.
 *
 * The site renders from the CSS, so a token edited in only one place ships the stale colour
 * with every test still green — the same silent failure the native mirror closes.
 *
 * Web's mapping is less direct than native's: a handful of tokens are declared as `--color-*`
 * in `@theme`, and the rest arrive through shadcn's role vars (`--card` is `surface`,
 * `--muted-foreground` is `foregroundMuted`). The table below is the only written record of
 * which role carries which token.
 *
 * `.href` (a string), not the URL object: this app resolves `URL` to the DOM one, which isn't
 * assignable to node's `fileURLToPath` parameter — same idiom as apps/native's mirror test.
 */
const CSS = readFileSync(
  fileURLToPath(new URL('../app/globals.css', import.meta.url).href),
  'utf8',
);

/** semantic token key → the CSS custom property that carries it. */
const ROLE_MAP: Partial<Record<keyof typeof semantic, string>> = {
  background: '--background',
  surface: '--card', // shadcn role — cards, popovers
  surfaceMuted: '--color-surface-muted',
  foreground: '--foreground',
  foregroundMuted: '--muted-foreground',
  aura: '--color-aura',
  border: '--border',
  success: '--color-success',
  error: '--color-error',
  auraSoft: '--color-aura-soft',
  auraLine: '--color-aura-line',
  onAura: '--color-on-aura',
  // Moved out of NOT_ON_WEB by #545: `border-hair` had shipped on the /@handle and
  // /dream/[id] avatar rings while the token was undeclared, so the utility emitted nothing
  // and the rings fell through to the `border-border` base rule. Web draws the hairline now.
  hair: '--color-hair',
};

/**
 * Tokens web deliberately does not declare. `ink2`/`faint` are the mobile body-copy ramp,
 * `raise`/`raise2` are the native card/chip lift, and `onError` has no destructive fill on this
 * site yet. Listing them is what makes the exhaustiveness check below meaningful: a new token
 * cannot be added to `tokens.ts` without a decision recorded here.
 *
 * `hair` sat here until #545, on the same "native recipe" reasoning — and that is exactly the
 * failure mode this list has: the entry kept asserting a decision that two shipped pages had
 * already contradicted, and nothing went red, because the exhaustiveness check below only
 * requires the union to cover the TS keys. A token in this list means "web draws nothing with
 * it"; grep the utility (`border-<token>`, `bg-<token>`, `text-<token>`) before adding one.
 */
const NOT_ON_WEB: (keyof typeof semantic)[] = ['ink2', 'faint', 'raise', 'raise2', 'onError'];

/** First declaration of exactly `name` — the lookbehind keeps `--background` off `--color-background`. */
function cssVar(name: string): string | undefined {
  return CSS.match(new RegExp(`(?<![\\w-])${name}\\s*:\\s*([^;]+);`))?.[1]?.trim();
}

/**
 * Compare colours by VALUE, not spelling: the two files legitimately differ in notation — CSS
 * lowercases hex and writes `rgba(43, 208, 210, 0.1)` where TS writes `rgba(43,208,210,0.10)`.
 */
function norm(v: string): string {
  const s = v.toLowerCase().replace(/\s+/g, '');
  const rgba = s.match(/^rgba?\(([^)]+)\)$/);
  if (!rgba) return s;
  const [r, g, b, a] = rgba[1]?.split(',').map((p) => Number(p)) ?? [];
  return `rgba(${r},${g},${b},${a ?? 1})`;
}

/** `{ '--name': 'value' }` for one `selector { … }` block. */
function block(selector: string): Record<string, string> {
  const body = CSS.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1] as string, m[2] as string]),
  );
}

describe('globals.css mirrors the config tokens', () => {
  it.each(Object.entries(ROLE_MAP))('semantic.%s === %s', (key, cssName) => {
    const fromCss = cssVar(cssName as string);
    expect(fromCss, `${cssName} missing from globals.css`).toBeDefined();
    expect(norm(fromCss as string)).toBe(norm(semantic[key as keyof typeof semantic]));
  });

  it('carries the mandala gradient too', () => {
    for (const [n, value] of Object.entries(gradient)) {
      expect(norm(cssVar(`--color-gradient-${n}`) as string)).toBe(norm(value));
    }
  });

  it('accounts for every semantic token — a new one cannot be added to TS only', () => {
    expect([...Object.keys(ROLE_MAP), ...NOT_ON_WEB].sort()).toEqual(Object.keys(semantic).sort());
  });

  it('declares no colour that is not a token', () => {
    // The CSS-side half of "no literal hex in app code" (rule 4): every literal colour in the
    // stylesheet must be a value tokens.ts defines, whatever role var it is spelled into.
    //
    // Comments are stripped first (#545). The scan is a regex over the file, so it could not
    // tell a painted colour from one being TALKED about, and an issue number (`#545`) or a
    // quoted old value in a docblock read as undeclared literals — which pushed prose away
    // from naming the very values these comments exist to explain. A colour inside a comment
    // paints nothing. The cost is that a commented-OUT declaration no longer trips this.
    const known = new Set([...Object.values(semantic), ...Object.values(gradient)].map(norm));
    const literals =
      CSS.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? [];
    expect([...new Set(literals.map(norm))].filter((c) => !known.has(c))).toEqual([]);
  });

  it('keeps :root and .dark identical — Athanor is one dark world', () => {
    // globals.css says the two blocks are intentionally the same. If they ever drift, the
    // shadcn `dark` class silently becomes a second theme nobody designed.
    const root = block(':root');
    for (const [name, value] of Object.entries(block('\\.dark'))) {
      expect(root[name], `${name} declared in .dark but not :root`).toBeDefined();
      expect(norm(value), `${name} differs between :root and .dark`).toBe(
        norm(root[name] as string),
      );
    }
  });
});

// ---------------------------------------------------------------------------------------
// A token in NOT_ON_WEB must not be spelled as a utility anywhere in apps/web (#550)
// ---------------------------------------------------------------------------------------

/**
 * The list above is a claim about the SOURCE, and until now nothing read the source.
 *
 * #545 is the whole argument: `hair` sat in `NOT_ON_WEB` while `border-hair` had already
 * shipped on the /@handle and /dream/[id] avatar rings. Tailwind emits nothing for an
 * undeclared utility, so the rings fell through to the `border-border` base rule and painted
 * an opaque fill where a translucent hairline belonged — and every test stayed green, because
 * the exhaustiveness check two blocks up only requires `ROLE_MAP ∪ NOT_ON_WEB` to cover the TS
 * keys. It never asked whether the "web draws nothing with it" half was true. A human noticed.
 *
 * This is that half, made mechanical: for each token web declines to declare, no `-<token>`
 * utility may appear in the tree. It would have caught #545 the day the ring shipped.
 *
 * ## Two spellings per token, because the mapping is not mechanical
 *
 * `apps/native/src/lib/tokens-mirror.test.ts`'s own `NAME_MAP` docblock says the token→CSS
 * name mapping is "NOT mechanical camelCase→kebab" and names two tokens that diverge outright
 * (`foregroundMuted` → `muted-foreground`, `border` → `line`). Neither divergence is in
 * `NOT_ON_WEB`, and for the five that are, kebab-casing reproduces native's map exactly
 * (`ink2`→`ink-2`, `raise2`→`raise-2`, `onError`→`on-error`). But web has never mapped any of
 * them, so there is no fixed answer for what one WOULD be called here if it shipped — so both
 * the key as written and its kebab form are hunted, and a hit under either is a hit.
 *
 * That table cannot simply be imported: it lives in `apps/native`, and the dependency rule is
 * `apps → packages` only. The kebab function below is the honest substitute — narrower than
 * the real mapping, and stated as such rather than assumed away.
 *
 * ## Why the scan reads string literals and not the file
 *
 * A utility only ever reaches the DOM through a string — `className="bg-faint"`, a template
 * literal, a `cn()`/`cva()` argument. Scanning literals rather than raw text therefore drops
 * the two false positives a raw grep has for free: prose in a comment TALKING about a utility
 * (the failure #545's own fix hit in this file's sibling assertion, which had to start
 * stripping comments for exactly this reason), and a hyphenated identifier that merely ends in
 * a token's name. The residue is a class name quoted inside a comment, which still reads as a
 * hit — loud, and it argues for itself in review, which is the safe direction for a guard.
 *
 * `globals.css` is scanned too, comments stripped: in Tailwind 4 a `--color-*` declaration in
 * `@theme` is what MAKES the utility, so `--color-faint: …` and `@apply bg-faint` are the same
 * event as far as this list is concerned.
 */
const WEB = fileURLToPath(new URL('..', import.meta.url).href);

/** Build outputs only — everything else under apps/web is source and gets scanned. A new
 *  build directory therefore reads as source and can only over-report, never hide a hit. */
const NOT_SOURCE = new Set([
  'node_modules',
  '.next',
  '.open-next',
  '.turbo',
  '.wrangler',
  '.vercel',
  'coverage',
  'test-results',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (NOT_SOURCE.has(name)) continue;
    const p = `${dir}${name}`;
    if (statSync(p).isDirectory()) walk(`${p}/`, out);
    else out.push(p);
  }
  return out;
}

/**
 * This file names every token it forbids, so scanning itself would make the assertion
 * self-fulfilling the moment a docblock here quotes one of the utilities — the same trap
 * `apps/native/src/lib/source-audit.test.ts` excludes itself by path to avoid.
 */
const SELF = fileURLToPath(new URL(import.meta.url).href);
const EVERY_FILE = walk(WEB);
const SOURCES = EVERY_FILE.filter((p) => /\.tsx?$/.test(p) && p !== SELF);
/** Every stylesheet, `globals.css` and the CSS modules alike — `@apply` works in all of them. */
const STYLESHEETS = EVERY_FILE.filter((p) => p.endsWith('.css'));

/** Repo-relative path, for a failure message someone can act on. */
const webRel = (p: string) => `apps/web/${p.slice(WEB.length)}`;

/** Every `'…'`, `"…"` and `` `…` `` body in a TS/TSX source, with its 1-based line. */
function stringLiterals(src: string): { text: string; line: number }[] {
  const re = /'[^'\\\n]*(?:\\.[^'\\\n]*)*'|"[^"\\\n]*(?:\\.[^"\\\n]*)*"|`[^`\\]*(?:\\.[^`\\]*)*`/g;
  return [...src.matchAll(re)].map((m) => ({
    text: m[0] as string,
    line: src.slice(0, m.index).split('\n').length,
  }));
}

/**
 * Every string literal in every apps/web source, with where it came from. Built ONCE at module
 * load: the scan runs per spelling, and re-reading the tree inside each case walked it ten times
 * over to answer ten questions about the same bytes.
 */
const LITERALS = SOURCES.flatMap((p) =>
  stringLiterals(readFileSync(p, 'utf8')).map((s) => ({
    at: `${webRel(p)}:${s.line}`,
    text: s.text,
  })),
);

/**
 * Escape a token name for embedding in a RegExp source. One helper, used by BOTH patterns
 * below: it was spelled twice, and the second copy was subtly wrong in a way nothing could
 * catch — no `keyof typeof semantic` contains a regex metacharacter, so the broken class
 * silently escaped nothing and would only have mattered the day a token name did.
 */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `ink2` → `ink-2`, `onError` → `on-error`. See the docblock: narrower than native's map. */
const kebab = (k: string) => k.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();

/**
 * A Tailwind utility ending in `-<name>`: some prefix (`bg`, `text`, `border-t`, and whatever
 * else Tailwind grows), a hyphen, then the token. Deliberately NOT an allow-list of prefixes —
 * an allow-list that misses one is a silent hole, which is the defect this whole section
 * exists to close. A trailing `/20` opacity modifier or a `hover:` variant still matches,
 * because neither `/` nor `:` is a word character.
 */
const utility = (name: string) =>
  new RegExp(`(?<![\\w-])[A-Za-z][\\w-]*-${escapeRe(name)}(?![\\w-])`);

describe('a token web declines to declare is never spelled as a utility (#550)', () => {
  const spellings = NOT_ON_WEB.flatMap((k) => [...new Set([k as string, kebab(k as string)])]);

  it('scans the tree it claims to scan', () => {
    // Without this, a walker that silently returned [] would make every assertion below pass.
    expect(SOURCES.length, 'no apps/web sources found — has the layout moved?').toBeGreaterThan(50);
    expect(spellings.length, 'NOT_ON_WEB is empty — nothing is being hunted').toBeGreaterThan(0);
  });

  it.each(spellings)('no `-%s` utility in apps/web source', (name) => {
    const re = utility(name);
    const hits = LITERALS.filter((l) => re.test(l.text)).map((l) => `${l.at}  ${l.text.trim()}`);
    expect(
      hits,
      `\`${name}\` is in NOT_ON_WEB — globals.css declares no such token, so this utility ` +
        `emits nothing and the element falls through to whatever base rule covers it (#545 ` +
        `was exactly that, silently, for months):\n  ${hits.join('\n  ')}\n` +
        `Either drop the utility, or declare the token in globals.css, add it to ROLE_MAP and ` +
        `take it out of NOT_ON_WEB — the decision, either way, gets written down.`,
    ).toEqual([]);
  });

  it.each(spellings)('no `-%s` utility or @theme declaration in any stylesheet', (name) => {
    // `@apply bg-faint` and `--color-faint: …` are the same event: in Tailwind 4 the `@theme`
    // declaration is what CREATES the utility. Comments stripped, same idiom as the
    // "declares no colour that is not a token" assertion above and for the same reason.
    //
    // EVERY stylesheet, not just globals.css: `@apply` works in a CSS module too, and scoping
    // this to the one file left `components/*.module.css` as a hole the section did not admit to.
    //
    // Two patterns, not one. `utility()` cannot see a declaration: its `(?<![\\w-])` guard is
    // what keeps `border-` off `--color-border`, and that same guard makes every `--color-*`
    // name unmatchable. Asserting only the utility form here would have left the half this
    // section's docblock claims to cover — the declaration — silently unguarded.
    const declared = new RegExp(`--color-${escapeRe(name)}\\s*:`);
    const hits = STYLESHEETS.filter((p) => {
      const css = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      return utility(name).test(css) || declared.test(css);
    }).map(webRel);
    expect(
      hits,
      `\`${name}\` is listed in NOT_ON_WEB but a stylesheet spells it — the list says web ` +
        `draws nothing with this token, and the stylesheet disagrees:\n  ${hits.join('\n  ')}\n` +
        `Declaring the token is a decision: make it, and move the key into ROLE_MAP.`,
    ).toEqual([]);
  });
});
