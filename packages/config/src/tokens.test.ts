import { describe, expect, test } from 'vitest';
import * as barrel from './index';
import {
  broadsheet,
  galleria,
  galleriaType,
  gradient,
  mandorla,
  radius,
  semantic,
  spacing,
  typography,
} from './tokens';

// Why a suite for a file of constants: `turbo test` skipped this whole workspace in silence
// until it had a `test` script (#172), and a token typo here is invisible at the source. A
// malformed color does not throw — it lands in a Tailwind @theme block or a NativeWind style
// and renders as nothing, on whichever screen happens to use that role. These assertions are
// the cheap half of that: shape, parseability, and the values CLAUDE.md rule 4 pins by name for
// each look. The contrast RATIOS are asserted elsewhere and recomputed from these very
// values, so a retune here fails there: the mobile pairs in
// apps/native/src/lib/contrast.test.ts, the web's in ./contrast.test.ts.

/** #RRGGBB, uppercase or lower. Three-digit shorthand is deliberately rejected: the file is
 *  documented in six-digit form and the two notations would diff badly against each other. */
const HEX6 = /^#[0-9a-fA-F]{6}$/;
/** rgba(r,g,b,a) as authored here — no spaces, decimal alpha. */
const RGBA = /^rgba\((\d{1,3}),(\d{1,3}),(\d{1,3}),(0|1|0?\.\d+)\)$/;

describe('semantic tokens', () => {
  test('every role is a parseable color literal', () => {
    for (const [role, value] of Object.entries(semantic)) {
      expect(HEX6.test(value) || RGBA.test(value), `${role} = ${value}`).toBe(true);
    }
  });

  test('rgba channels stay in range and alpha within 0..1', () => {
    for (const [role, value] of Object.entries(semantic)) {
      const match = RGBA.exec(value);
      if (!match) continue;
      const [, r, g, b, a] = match;
      for (const channel of [r, g, b]) {
        expect(Number(channel), `${role} channel`).toBeLessThanOrEqual(255);
      }
      expect(Number(a), `${role} alpha`).toBeLessThanOrEqual(1);
    }
  });

  // Rule 4 names these four explicitly. Pinning them means a "harmless" palette tweak has to
  // argue with the brand rule rather than slip through as a diff nobody reads.
  test('the brand-pinned roles hold their documented values', () => {
    expect(semantic.aura).toBe('#2BD0D2');
    expect(semantic.background).toBe('#0A0A1A');
    expect(semantic.foreground).toBe('#F0EDF7');
  });

  test('the aura-derived translucents are the same cyan', () => {
    // auraSoft/auraLine are the framed active surface, and the surface auraGlow() lays its
    // shadow over — the pair alone is not the glow (§2.3, ruled 2026-09-07). If aura moves and
    // these do not, both desaturate against their own CTA and nobody notices until a screenshot.
    const cyan = '43,208,210';
    expect(semantic.auraSoft.startsWith(`rgba(${cyan},`)).toBe(true);
    expect(semantic.auraLine.startsWith(`rgba(${cyan},`)).toBe(true);
  });
});

/**
 * `galleria` is the mobile app's palette since 2026-10-03 (#921, DESIGN.md §3 «Mobile»): a black
 * stage, charcoal blocks, one grey for secondary text. `semantic` above stays the web's dark
 * world and is never retuned for the app's sake.
 */
describe('galleria tokens', () => {
  test('every role is a parseable color literal', () => {
    for (const [role, value] of Object.entries(galleria)) {
      expect(HEX6.test(value) || RGBA.test(value), `${role} = ${value}`).toBe(true);
    }
  });

  test('rgba channels stay in range and alpha within 0..1', () => {
    for (const [role, value] of Object.entries(galleria)) {
      const match = RGBA.exec(value);
      if (!match) continue;
      const [, r, g, b, a] = match;
      for (const channel of [r, g, b]) {
        expect(Number(channel), `${role} channel`).toBeLessThanOrEqual(255);
      }
      expect(Number(a), `${role} alpha`).toBeLessThanOrEqual(1);
    }
  });

  // Rule 4's mobile half names the stage, the charcoal and the two accents; DESIGN.md §3 prints
  // the rest of the table. Pinned for the same reason as the web's four above.
  test('the roles hold the values rule 4 and DESIGN.md §3 print', () => {
    expect(galleria.background).toBe('#000000');
    expect(galleria.surface).toBe('#1D1D1F');
    expect(galleria.hair).toBe('#333336');
    expect(galleria.foreground).toBe('#F5F5F7');
    expect(galleria.foregroundMuted).toBe('#86868B');
    expect(galleria.onAura).toBe('#04222A');
    expect(galleria.error).toBe('#E5536F');
    expect(galleria.appleButtonBg).toBe('#FFFFFF');
    expect(galleria.appleButtonInk).toBe('#000000');
  });

  test('the cyan is the one value both looks share', () => {
    expect(galleria.aura).toBe('#2BD0D2');
    expect(galleria.aura).toBe(semantic.aura);
  });

  test('the red is a mobile value — the web keeps its own', () => {
    // #E0476B reads 4.23:1 on charcoal, under AA for text (ruled 2026-10-03).
    expect(galleria.error).not.toBe(semantic.error);
  });

  /**
   * The legacy aliases. Galleria has no counterpart for these ten roles, and every screen that
   * has not been converted still names them, so each answers with an interim value that keeps
   * the screen legible before its own conversion (#921, open as of 2026-10-03). The rule the
   * table follows: an alias resolves to a Galleria role, or keeps the dark world's value where
   * its sites convert later. `raise2` is the one colour of its own — a chip inside a charcoal
   * card has to stay visible.
   */
  test('a legacy alias resolves to a Galleria role or keeps its old value', () => {
    expect(galleria.raise).toBe(galleria.surface);
    expect(galleria.surfaceMuted).toBe(galleria.surface);
    expect(galleria.ink2).toBe(galleria.foreground);
    expect(galleria.faint).toBe(galleria.foregroundMuted);
    expect(galleria.border).toBe(galleria.hair);
    expect(galleria.raise2).toBe('#2C2C2E');
    for (const kept of ['auraSoft', 'auraLine', 'onError', 'success'] as const) {
      expect(galleria[kept], kept).toBe(semantic[kept]);
    }
  });

  test('the aura-derived translucents are the same cyan', () => {
    const cyan = '43,208,210';
    expect(galleria.auraSoft.startsWith(`rgba(${cyan},`)).toBe(true);
    expect(galleria.auraLine.startsWith(`rgba(${cyan},`)).toBe(true);
  });
});

describe('brand-mark tokens', () => {
  test('the mandala gradient is the documented magenta → violet → indigo', () => {
    expect(gradient).toEqual({ 1: '#7D236E', 2: '#672088', 3: '#223D86' });
  });

  test('mandorla mark colors are hex', () => {
    for (const [part, value] of Object.entries(mandorla)) {
      expect(HEX6.test(value), `${part} = ${value}`).toBe(true);
    }
  });
});

describe('the landing broadsheet palette', () => {
  test('every value is a six-digit hex', () => {
    for (const [role, value] of Object.entries(broadsheet)) {
      expect(HEX6.test(value), `${role} = ${value}`).toBe(true);
    }
  });

  test('it carries no cyan — the landing has one accent, and it is violet', () => {
    expect(Object.values(broadsheet)).not.toContain(semantic.aura);
  });

  test('its violet is the mandala violet, not a near-miss of it', () => {
    expect(broadsheet.violet).toBe(gradient[2]);
  });
});

describe('scale tokens', () => {
  test('spacing and radius are positive finite numbers', () => {
    for (const [name, value] of [...Object.entries(spacing), ...Object.entries(radius)]) {
      expect(Number.isFinite(value), name).toBe(true);
      expect(value, name).toBeGreaterThan(0);
    }
  });

  test('the mobile gutter DESIGN.md §6 states is 20', () => {
    expect(spacing.gutter).toBe(20);
  });

  test('font weights are the CSS 100..900 ladder', () => {
    for (const [name, weight] of Object.entries(typography.weights)) {
      expect(weight % 100, name).toBe(0);
      expect(weight, name).toBeGreaterThanOrEqual(100);
      expect(weight, name).toBeLessThanOrEqual(900);
    }
  });

  test('the dream register is the same family, italic — not a second face', () => {
    // Rule 4: one font family. A second family name here is the regression to catch.
    expect(typography.dreamRegister).toBe(`${typography.fontFamily} italic`);
  });
});

/**
 * The mobile type scale (Galleria; DESIGN.md §4 «Scale — mobile»). Each style is a `type-<name>`
 * class in apps/native/src/global.css, and tokens-mirror.test.ts there holds every class to
 * these values: this block pins the table the document prints, that one pins what the app
 * renders. `tracking` is em, as the table prints it; the stylesheet states it in px.
 */
describe('the mobile type scale', () => {
  // The table of DESIGN.md §4, row for row — pinned for the same reason as the palettes above:
  // a retune has to argue with the document.
  test('the nine styles hold the values DESIGN.md §4 prints', () => {
    expect(galleriaType).toEqual({
      h1: { size: 32, lineHeight: 36, weight: 600, tracking: -0.02 },
      title: { size: 24, lineHeight: 27, weight: 600, tracking: -0.02 },
      h2: { size: 19, lineHeight: 23, weight: 600, tracking: -0.01 },
      body: { size: 17, lineHeight: 24, weight: 400, tracking: 0 },
      small: { size: 15, lineHeight: 21, weight: 400, tracking: 0 },
      label: { size: 13, lineHeight: 17, weight: 500, tracking: 0 },
      quote: { size: 18, lineHeight: 23, weight: 400, tracking: 0, italic: true },
      num: { size: 44, lineHeight: 44, weight: 800, tracking: -0.03, tabular: true },
      numM: { size: 26, lineHeight: 26, weight: 800, tracking: -0.03, tabular: true },
    });
  });

  test('every weight is one the app loads a face for', () => {
    // On device a weight is a font FILE — one family name per weight, loaded in
    // apps/native/src/app/_layout.tsx. A weight outside `typography.weights` has no face, and
    // the text falls back to the platform font without an error.
    const loaded: number[] = Object.values(typography.weights);
    for (const [name, style] of Object.entries(galleriaType)) {
      expect(loaded, name).toContain(style.weight);
    }
  });

  test('the one italic style is the dream register, at regular weight', () => {
    // DESIGN.md §4: no italics for UI, the dream quote is the exception. And that register is
    // a single file, Hanken 400 italic: an italic style at another weight would name a face
    // nobody loads.
    const italic = Object.entries(galleriaType).filter(([, style]) => 'italic' in style);
    expect(italic.map(([name]) => name)).toEqual(['quote']);
    for (const [name, style] of italic) {
      expect(style.weight, name).toBe(typography.weights.regular);
    }
  });
});

describe('the barrel', () => {
  // Apps import from '@athanor/config', which resolves to src/index.ts. A token added to
  // tokens.ts but not reachable through the barrel is a token no app can use.
  test('re-exports every runtime token export', () => {
    expect(Object.keys(barrel).sort()).toEqual(
      [
        'broadsheet',
        'galleria',
        'galleriaType',
        'gradient',
        'mandorla',
        'radius',
        'semantic',
        'spacing',
        'typography',
      ].sort(),
    );
  });
});
