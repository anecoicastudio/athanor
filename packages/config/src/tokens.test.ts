import { describe, expect, test } from 'vitest';
import * as barrel from './index';
import { gradient, mandorla, radius, semantic, spacing, typography } from './tokens';

// Why a suite for a file of constants: `turbo test` skipped this whole workspace in silence
// until it had a `test` script (#172), and a token typo here is invisible at the source. A
// malformed color does not throw — it lands in a Tailwind @theme block or a NativeWind style
// and renders as nothing, on whichever screen happens to use that role. These assertions are
// the cheap half of that: shape, parseability, and the four values CLAUDE.md rule 4 pins by
// name. The contrast RATIOS are asserted elsewhere, in apps/native/src/lib/contrast.test.ts,
// which recomputes them from these very values — so a retune here fails there.

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
    // auraSoft/auraLine are the glow surfaces. If aura moves and these do not, the glow
    // desaturates against its own CTA and nobody notices until a screenshot.
    const cyan = '43,208,210';
    expect(semantic.auraSoft.startsWith(`rgba(${cyan},`)).toBe(true);
    expect(semantic.auraLine.startsWith(`rgba(${cyan},`)).toBe(true);
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

describe('the barrel', () => {
  // Apps import from '@athanor/config', which resolves to src/index.ts. A token added to
  // tokens.ts but not reachable through the barrel is a token no app can use.
  test('re-exports every runtime token export', () => {
    expect(Object.keys(barrel).sort()).toEqual(
      ['gradient', 'mandorla', 'radius', 'semantic', 'spacing', 'typography'].sort(),
    );
  });
});
