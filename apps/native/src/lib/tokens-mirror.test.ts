import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gradient, radius, semantic, spacing } from '@athanor/config';
import { describe, expect, it } from 'vitest';

/**
 * `global.css` must mirror `packages/config/src/tokens.ts` — its own header says so ("values
 * mirror packages/config/src/tokens.ts. Update both together"), and nothing enforced it.
 *
 * The app renders from the CSS. `contrast.test.ts` reads the TS. So a token edited in only one
 * file leaves every contrast assertion passing while the running app shows the old colour —
 * the tests would certify a value the user never sees. This closes that.
 *
 * Covers every `semantic` colour, the mandala `gradient`, and the three `radius` values the
 * stylesheet declares — NOT the type scale or font families, which have no `tokens.ts` twin.
 *
 * The name mapping is NOT mechanical camelCase→kebab; two tokens diverge outright
 * (`foregroundMuted` → `--color-muted-foreground`, `border` → `--color-line`). The explicit
 * table below is the only written record of that.
 */
// `.href` (a string), not the URL object: this app's lib resolves `URL` to the DOM one, which
// isn't assignable to node's `fileURLToPath` parameter.
const CSS = readFileSync(fileURLToPath(new URL('../global.css', import.meta.url).href), 'utf8');

/** semantic token key → CSS custom property name (without the `--color-` prefix). */
const NAME_MAP: Record<keyof typeof semantic, string> = {
  background: 'background',
  surface: 'surface',
  surfaceMuted: 'surface-muted',
  foreground: 'foreground',
  foregroundMuted: 'muted-foreground', // diverges — not `foreground-muted`
  aura: 'aura',
  border: 'line', // diverges — the CSS calls it `line`
  bandAlt: 'band-alt',
  inkOnLight: 'ink-on-light',
  inkMutedOnLight: 'ink-muted-on-light',
  success: 'success',
  error: 'error',
  ink2: 'ink-2',
  faint: 'faint',
  raise: 'raise',
  raise2: 'raise-2',
  hair: 'hair',
  auraSoft: 'aura-soft',
  auraLine: 'aura-line',
  onAura: 'on-aura',
  onError: 'on-error',
};

/** Read a `--color-*` declaration out of the stylesheet. */
function cssVar(name: string): string | undefined {
  return CSS.match(new RegExp(`--color-${name}\\s*:\\s*([^;]+);`))?.[1]?.trim();
}

/**
 * Compare colours by VALUE, not by spelling. The two files legitimately differ in notation —
 * CSS is lowercased and drops trailing alpha zeros (`0.1`), TS writes `0.10` — and a textual
 * match would report those as mismatches while a real one-file edit hid among the noise.
 */
function norm(v: string): string {
  const s = v.toLowerCase().replace(/\s+/g, '');
  const rgba = s.match(/^rgba?\(([^)]+)\)$/);
  if (!rgba) return s; // hex, already canonical
  const parts = rgba[1]?.split(',').map((p) => Number(p)) ?? [];
  const [r, g, b, a] = parts;
  return `rgba(${r},${g},${b},${a ?? 1})`;
}

describe('global.css mirrors the config tokens', () => {
  it.each(Object.entries(NAME_MAP))('semantic.%s === --color-%s', (key, cssName) => {
    const fromCss = cssVar(cssName);
    const fromTs = semantic[key as keyof typeof semantic];
    expect(fromCss, `--color-${cssName} missing from global.css`).toBeDefined();
    expect(norm(fromCss as string)).toBe(norm(fromTs));
  });

  it('carries the mandala gradient too', () => {
    for (const [n, value] of Object.entries(gradient)) {
      expect(norm(cssVar(`gradient-${n}`) as string)).toBe(norm(value));
    }
  });

  it('maps every semantic token — a new one cannot be added to TS only', () => {
    expect(Object.keys(NAME_MAP).sort()).toEqual(Object.keys(semantic).sort());
  });

  // Only the radii the stylesheet actually declares. `radius` also carries sm/md/lg/full, which
  // Tailwind already provides and global.css deliberately doesn't restate.
  it.each(['ctl', 'card', 'hero'] as const)('radius.%s === --radius-%s', (key) => {
    const declared = CSS.match(new RegExp(`--radius-${key}\\s*:\\s*([^;]+);`))?.[1]?.trim();
    expect(declared, `--radius-${key} missing from global.css`).toBeDefined();
    expect(declared).toBe(`${radius[key]}px`);
  });

  // Only the spacing the stylesheet actually declares. `spacing` also carries xs..2xl, which
  // Tailwind's numeric scale already covers and global.css deliberately doesn't restate.
  it.each(['gutter'] as const)('spacing.%s === --spacing-%s', (key) => {
    const declared = CSS.match(new RegExp(`--spacing-${key}\\s*:\\s*([^;]+);`))?.[1]?.trim();
    expect(declared, `--spacing-${key} missing from global.css`).toBeDefined();
    expect(declared).toBe(`${spacing[key]}px`);
  });

  it('defines no --color-* the map does not know about', () => {
    const declared = [...CSS.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]);
    const known = new Set([
      ...Object.values(NAME_MAP),
      ...Object.keys(gradient).map((n) => `gradient-${n}`),
    ]);
    expect(declared.filter((n) => !known.has(n as string))).toEqual([]);
  });
});
