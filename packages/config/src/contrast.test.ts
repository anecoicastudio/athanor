import { describe, expect, it } from 'vitest';
import { AA_LARGE, AA_NORMAL, luminance, over, ratio } from './contrast';
import { semantic } from './tokens';

/**
 * The arithmetic, and the WEB's pairs.
 *
 * `contrast.ts` moved here from apps/native on 2026-10-03 (#921). Its own header had always
 * said it belonged beside the tokens it certifies. The mobile palette's suite stays in
 * apps/native/src/lib/contrast.test.ts, next to the call sites its comments name. This file
 * holds what is true of the module itself, and the ratios of `semantic` on the surfaces the web
 * draws: the app's suite recomputed those until it moved to `galleria`, and nothing else would.
 */

describe('over', () => {
  it('composites a translucent layer onto an opaque backdrop', () => {
    expect(over('rgba(255,255,255,0.04)', '#0A0A1A')).toBe('#141423');
    expect(over('rgba(0,0,0,1)', '#FFFFFF')).toBe('#000000');
    expect(over('rgba(255,255,255,0)', '#0A0A1A')).toBe('#0a0a1a');
  });

  it('chains, so a chip inside a card lands on the real backdrop', () => {
    // The stack this function was written for: a 6.5% white chip over a 4% white card over the
    // dark canvas. Nesting is NOT the same surface as the layer straight on the canvas.
    const card = over('rgba(255,255,255,0.04)', '#0A0A1A');
    const nested = over('rgba(255,255,255,0.065)', card);
    expect(nested).toBe('#232331');
    expect(nested).not.toBe(over('rgba(255,255,255,0.065)', '#0A0A1A'));
  });

  it('reads rgb() with no alpha as opaque', () => {
    expect(over('rgb(43,208,210)', '#000000')).toBe('#2bd0d2');
  });

  it('refuses a hex layer: an opaque surface is a token, not a composite', () => {
    // The trap Galleria set: once a surface token is a hex, `over(token, backdrop)` at the top
    // of a test file throws at import and the whole file stops collecting.
    expect(() => over('#1D1D1F', '#000000')).toThrow('not an rgb(a) color');
  });

  it('refuses a malformed layer rather than compositing NaN', () => {
    expect(() => over('rgba(255,255)', '#000000')).toThrow('malformed rgb(a) color');
    expect(() => over('rgba(a,b,c,1)', '#000000')).toThrow('malformed rgb(a) color');
  });
});

describe('luminance / ratio', () => {
  it('anchors at the WCAG extremes', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(ratio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(ratio('#0A0A1A', '#0A0A1A')).toBeCloseTo(1, 5);
  });

  it('is order-independent', () => {
    expect(ratio('#000000', '#FFFFFF')).toBe(ratio('#FFFFFF', '#000000'));
  });

  it('expands shorthand hex to the same colour as the long form', () => {
    // NOT `ratio('#FFF','#000') === ratio('#000','#FFF')` — ratio() sorts hi/lo internally, so
    // that holds by construction for any implementation, right or wrong.
    expect(ratio('#FFF', '#000')).toBeCloseTo(ratio('#FFFFFF', '#000000'), 10);
    expect(luminance('#F0EDF7')).toBeCloseTo(luminance(semantic.foreground), 10);
  });

  it('refuses a string that is not a hex colour', () => {
    expect(() => luminance('#12345')).toThrow('not a hex color');
    expect(() => luminance('rgba(0,0,0,1)')).toThrow('not a hex color');
  });
});

/**
 * `semantic` on the surfaces the web draws (docs/DESIGN.md §3 «Contrast — web»). Only the roles
 * apps/web declares in its stylesheet — `ROLE_MAP` in apps/web/lib/tokens-mirror.test.ts. The
 * roles that test lists as `NOT_ON_WEB` were the app's and are certified nowhere now.
 */
describe('the web’s pairs — semantic', () => {
  const CANVAS = semantic.background; // #0A0A1A — the page
  const CARD = semantic.surface; // #100A1C — `--card`: cards, popovers
  const AURA_SOFT = over(semantic.auraSoft, CANVAS); // #0d1e2c — an accent surface on the page

  it.each([
    ['foreground', 16.95, 16.78],
    ['foregroundMuted', 7.34, 7.27],
    ['aura', 10.32, 10.22],
    ['error', 4.93, 4.88],
    ['success', 7.38, 7.31],
  ] as const)('%s clears AA on the canvas and on a card', (token, onCanvas, onCard) => {
    expect(ratio(semantic[token], CANVAS)).toBeCloseTo(onCanvas, 2);
    expect(ratio(semantic[token], CARD)).toBeCloseTo(onCard, 2);
    expect(ratio(semantic[token], CARD)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('onAura is readable ink on a cyan fill', () => {
    expect(ratio(semantic.onAura, semantic.aura)).toBeCloseTo(8.72, 2);
  });

  it('text and the accent stay readable on an accent surface', () => {
    for (const token of ['foreground', 'foregroundMuted', 'aura'] as const) {
      expect(ratio(semantic[token], AURA_SOFT), token).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  // Forbidden pairs, carried over from the app's suite: no call site may use these.
  it('error on an accent surface stays unusable', () => {
    expect(ratio(semantic.error, AURA_SOFT)).toBeCloseTo(4.26, 2);
    expect(ratio(semantic.error, AURA_SOFT)).toBeLessThan(AA_NORMAL);
    expect(ratio(semantic.error, AURA_SOFT)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it('near-white on the error fill stays unusable', () => {
    expect(ratio(semantic.foreground, semantic.error)).toBeCloseTo(3.44, 2);
    expect(ratio(semantic.foreground, semantic.error)).toBeLessThan(AA_NORMAL);
  });
});
