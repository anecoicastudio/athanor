import { readFileSync } from 'node:fs';
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
};

/**
 * Tokens web deliberately does not declare. `ink2`/`faint` are the mobile body-copy ramp, the
 * three translucent surfaces are the native card/chip recipe, and `onError` has no destructive
 * fill on this site yet. Listing them is what makes the exhaustiveness check below meaningful:
 * a new token cannot be added to `tokens.ts` without a decision recorded here.
 */
const NOT_ON_WEB: (keyof typeof semantic)[] = [
  'ink2',
  'faint',
  'raise',
  'raise2',
  'hair',
  'onError',
];

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
    const known = new Set([...Object.values(semantic), ...Object.values(gradient)].map(norm));
    const literals = CSS.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? [];
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
