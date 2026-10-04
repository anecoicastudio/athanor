import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { galleria, galleriaType, gradient, radius, spacing, type TypeStyle } from '@athanor/config';
import { describe, expect, it } from 'vitest';

/**
 * `global.css` must mirror `packages/config/src/tokens.ts` — its own header says so ("values
 * mirror packages/config/src/tokens.ts. Update both together"), and nothing enforced it.
 *
 * The app renders from the CSS. `contrast.test.ts` reads the TS. So a token edited in only one
 * file leaves every contrast assertion passing while the running app shows the old colour —
 * the tests would certify a value the user never sees. This closes that.
 *
 * Covers every `galleria` colour, the mandala `gradient`, the three `radius` values the
 * stylesheet declares, the step of the spacing scale, and the type scale (`galleriaType` → the
 * `type-*` classes, second block below) — NOT the font families, which have no `tokens.ts` twin.
 *
 * The name mapping is NOT mechanical camelCase→kebab; two tokens diverge outright
 * (`foregroundMuted` → `--color-muted-foreground`, `border` → `--color-line`). The explicit
 * table below is the only written record of that.
 */
// `.href` (a string), not the URL object: this app's lib resolves `URL` to the DOM one, which
// isn't assignable to node's `fileURLToPath` parameter.
const CSS = readFileSync(fileURLToPath(new URL('../global.css', import.meta.url).href), 'utf8');

/** galleria token key → CSS custom property name (without the `--color-` prefix). */
const NAME_MAP: Record<keyof typeof galleria, string> = {
  background: 'background',
  surface: 'surface',
  surfaceMuted: 'surface-muted',
  foreground: 'foreground',
  foregroundMuted: 'muted-foreground', // diverges — not `foreground-muted`
  aura: 'aura',
  border: 'line', // diverges — the CSS calls it `line`
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
  appleButtonBg: 'apple-button-bg',
  appleButtonInk: 'apple-button-ink',
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
  it.each(Object.entries(NAME_MAP))('galleria.%s === --color-%s', (key, cssName) => {
    const fromCss = cssVar(cssName);
    const fromTs = galleria[key as keyof typeof galleria];
    expect(fromCss, `--color-${cssName} missing from global.css`).toBeDefined();
    expect(norm(fromCss as string)).toBe(norm(fromTs));
  });

  it('carries the mandala gradient too', () => {
    for (const [n, value] of Object.entries(gradient)) {
      expect(norm(cssVar(`gradient-${n}`) as string)).toBe(norm(value));
    }
  });

  it('maps every galleria token — a new one cannot be added to TS only', () => {
    expect(Object.keys(NAME_MAP).sort()).toEqual(Object.keys(galleria).sort());
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

  // The step of Tailwind's numeric scale (`p-4`, `gap-3`, `h-11`). Tailwind's default is
  // 0.25rem and react-native-css resolves a rem at 14, so without this line a step is 3.5 on
  // device against 4 in the web build: `p-4` 14, `h-11` 38.5 (measured on an iPhone SE
  // simulator and a moto g17, 2026-10-04). In px it is 4 on both, and the token scale lands on
  // whole steps: xs, sm, md, lg, xl, 2xl are `1`, `2`, `4`, `6`, `10`, `16`.
  it('spacing.xs === --spacing, the step of the numeric scale', () => {
    const declared = CSS.match(/--spacing\s*:\s*([^;]+);/)?.[1]?.trim();
    expect(
      declared,
      '--spacing missing from global.css: every numeric spacing class falls back to 3.5 a step on device',
    ).toBeDefined();
    expect(declared).toBe(`${spacing.xs}px`);
  });
});

/** galleriaType key → the class that carries it. */
const TYPE_CLASS: Record<keyof typeof galleriaType, string> = {
  h1: 'type-h1',
  title: 'type-title',
  h2: 'type-h2',
  body: 'type-body',
  small: 'type-small',
  label: 'type-label',
  quote: 'type-quote',
  num: 'type-num',
  numM: 'type-num-m', // diverges — kebab, not camel
};

/** Weight → the `@theme` variable whose face carries it (one font file = one family name). */
const FACE: Record<number, string> = {
  300: '--font-sans-light',
  400: '--font-sans',
  500: '--font-sans-medium',
  600: '--font-sans-semibold',
  700: '--font-sans-bold',
  800: '--font-sans-extrabold',
};

/** The stylesheet without its comments: a comment may quote a declaration. */
const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The stylesheet in two halves. `web` is the body of the `@supports selector(div > div)` block,
 * `device` is everything outside it. react-native-css compiles only the second — its
 * `supportsConditionValid` (`compiler/supports.ts`, 3.0.7) answers false for a `selector()`
 * condition — and a browser applies both.
 */
function halves(css: string): { device: string; web: string } {
  const open = css.indexOf('@supports selector(div > div)');
  const start = open === -1 ? -1 : css.indexOf('{', open);
  if (start === -1) return { device: css, web: '' };
  let depth = 0;
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) {
      return { device: css.slice(0, open) + css.slice(i + 1), web: css.slice(start + 1, i) };
    }
  }
  return { device: css, web: '' };
}

/** The declarations of every rule `.cls { … }` in `css`, one map per rule. */
function rules(css: string, cls: string): Record<string, string>[] {
  return [...css.matchAll(new RegExp(`\\.${cls}\\s*\\{([^{}]*)\\}`, 'g'))].map((m) =>
    Object.fromEntries(
      (m[1] ?? '')
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]),
    ),
  );
}

/** em → the px the stylesheet states, at two decimals. */
const px = (n: number) => Math.round(n * 100) / 100;

/**
 * The type scale: one `type-<name>` class per `galleriaType` style, holding size, line height,
 * tracking and face together. What each line of a class has to be was measured on an iPhone SE
 * simulator, a moto g17 and the react-native-web build on 2026-10-04:
 *
 * - `-rn-line-height`, not `line-height`. The standard property emits nothing on device: a
 *   `Text` at 32px measured 42 with `leading-[36px]` and 36 with `-rn-line-height: 36px`.
 * - Never both in one rule: the class then emits neither, and the line is 42 again.
 * - The browser ignores `-rn-*`, so the web build takes the standard properties from a
 *   `@supports selector(div > div)` block, which the device compiler skips.
 * - Tracking is stated in px: size × the em the token holds.
 */
describe('global.css carries the type scale', () => {
  const { device, web } = halves(BARE);
  const styleOf = (key: string): TypeStyle => galleriaType[key as keyof typeof galleriaType];

  it('has one web block for the device compiler to skip', () => {
    expect(
      web,
      'no `@supports selector(div > div) { … }` block in global.css: the web build has no line heights',
    ).not.toBe('');
  });

  it.each(Object.entries(TYPE_CLASS))('galleriaType.%s === .%s on device', (key, cls) => {
    const style = styleOf(key);
    const face = style.italic ? '--font-dream' : FACE[style.weight];
    const found = rules(device, cls);
    expect(
      found,
      `.${cls} must be one rule of its own outside @supports: a second rule overrides the first by source order`,
    ).toHaveLength(1);
    expect(found[0]).toEqual({
      'font-family': `var(${face})`,
      'font-weight': '400', // the face carries the weight; see the `.font-*` remaps
      'font-size': `${style.size}px`,
      '-rn-line-height': `${style.lineHeight}px`,
      ...(style.tracking !== 0 && { 'letter-spacing': `${px(style.size * style.tracking)}px` }),
      ...(style.tabular && { '-rn-font-variant': 'tabular-nums' }),
    });
    expect(BARE, `${face} is not declared in @theme`).toMatch(new RegExp(`${face}\\s*:`));
  });

  it.each(Object.entries(TYPE_CLASS))('galleriaType.%s === .%s in the web build', (key, cls) => {
    const style = styleOf(key);
    const found = rules(web, cls);
    expect(
      found,
      `.${cls} needs one rule inside the @supports block: the browser ignores -rn-line-height`,
    ).toHaveLength(1);
    expect(found[0]).toEqual({
      'line-height': `${style.lineHeight}px`,
      ...(style.tabular && { 'font-variant-numeric': 'tabular-nums' }),
    });
  });

  it('no device rule states line-height beside -rn-line-height', () => {
    const both = Object.values(TYPE_CLASS).filter((cls) =>
      rules(device, cls).some((r) => 'line-height' in r),
    );
    expect(
      both,
      'the standard property and its -rn- twin in ONE rule: the class emits no line height at ' +
        'all on device. Move `line-height` into the @supports block.',
    ).toEqual([]);
  });

  // react-native-css settles two classes that set the same property by where their rules sit
  // in the stylesheet, not by their order in `className`. After `.font-app`, a type class beats
  // the default face the `Text` wrapper prepends; before the weight remaps, a `font-bold` at
  // the call site still beats the class. Both seen on an iPhone SE simulator, 2026-10-04,
  // where a size, tracking or `leading-*` utility beside a type class also changed nothing.
  it('the type classes sit after .font-app and before the weight remaps', () => {
    const fontApp = device.indexOf('.font-app {');
    const firstRemap = device.indexOf('.font-light {');
    expect(fontApp, '.font-app rule not found').toBeGreaterThan(-1);
    expect(firstRemap, '.font-light rule not found').toBeGreaterThan(fontApp);
    for (const cls of Object.values(TYPE_CLASS)) {
      const at = device.indexOf(`.${cls} {`);
      expect(at, `.${cls} sits before .font-app: the default face would win`).toBeGreaterThan(
        fontApp,
      );
      expect(at, `.${cls} sits after the weight remaps: font-bold would lose`).toBeLessThan(
        firstRemap,
      );
    }
  });

  it('maps every style — a new one cannot be added to TS only', () => {
    expect(Object.keys(TYPE_CLASS).sort()).toEqual(Object.keys(galleriaType).sort());
  });

  it('declares no type-* class the map does not know about', () => {
    const declared = [...new Set([...BARE.matchAll(/\.(type-[a-z0-9-]+)/g)].map((m) => m[1]))];
    const known = new Set(Object.values(TYPE_CLASS));
    expect(declared.filter((cls) => !known.has(cls as string))).toEqual([]);
  });
});
