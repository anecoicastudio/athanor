import { semantic } from '@athanor/config';
import { describe, expect, it } from 'vitest';
import { AA_LARGE, AA_NORMAL, luminance, over, ratio } from './contrast';

/**
 * The surfaces text actually renders on, composed in render order. `raise`/`raise2`/`auraSoft`
 * are translucent, so these must be built with `over()` — naming the token is not enough.
 */
const CANVAS = semantic.background; // #0A0A1A — screens, modals
const SURFACE = semantic.surface; // #100A1C — sheets
const RAISE = over(semantic.raise, CANVAS); // #141423 — a card / list row
const RAISE2 = over(semantic.raise2, CANVAS); // #1A1A29 — a chip on the canvas
const NESTED = over(semantic.raise2, RAISE); // #232331 — a chip INSIDE a card ← the trap
const AURA_SOFT = over(semantic.auraSoft, CANVAS); // #0D1E2C — accent surface

describe('over', () => {
  it('composites a translucent layer onto an opaque backdrop', () => {
    expect(over('rgba(255,255,255,0.04)', semantic.background)).toBe('#141423');
    expect(over('rgba(0,0,0,1)', '#FFFFFF')).toBe('#000000');
    expect(over('rgba(255,255,255,0)', '#0A0A1A')).toBe('#0a0a1a');
  });

  it('chains, so a chip inside a card lands on the real backdrop', () => {
    expect(over(semantic.raise2, over(semantic.raise, CANVAS))).toBe('#232331');
    // The whole point: nesting is NOT the same surface as the token's own name.
    expect(NESTED).not.toBe(RAISE2);
  });
});

describe('luminance / ratio', () => {
  it('anchors at the WCAG extremes', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(ratio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(ratio('#0A0A1A', '#0A0A1A')).toBeCloseTo(1, 5);
  });

  it('expands shorthand hex to the same colour as the long form', () => {
    // NOT `ratio('#FFF','#000') === ratio('#000','#FFF')` — ratio() sorts hi/lo internally, so
    // that holds by construction for any implementation, right or wrong.
    expect(ratio('#FFF', '#000')).toBeCloseTo(ratio('#FFFFFF', '#000000'), 10);
    expect(luminance('#C9C3DE')).toBeCloseTo(luminance(semantic.ink2), 10);
  });
});

/**
 * The bug this module exists for. A `Tag` pill (`bg-raise-2`) inside a `SuggestionRow`
 * (`bg-raise`) does NOT sit on the surface `tokens.ts` certifies. `faint` was shipped there on
 * the strength of the 4.69 figure and was actually 4.23 — under the floor.
 */
describe('the nested-surface trap (regression)', () => {
  it('faint fails AA on a chip nested inside a card', () => {
    expect(ratio(semantic.faint, NESTED)).toBeCloseTo(4.229, 2);
    expect(ratio(semantic.faint, NESTED)).toBeLessThan(AA_NORMAL);
  });

  it('…while clearing it on the bare-canvas chip the token comment certifies', () => {
    expect(ratio(semantic.faint, RAISE2)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('foregroundMuted — the tone Tag.quiet actually uses — clears both', () => {
    expect(ratio(semantic.foregroundMuted, NESTED)).toBeCloseTo(5.798, 2);
    expect(ratio(semantic.foregroundMuted, NESTED)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(ratio(semantic.foregroundMuted, RAISE2)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

/**
 * `tokens.ts` lines 27-33 certify `faint` in prose. Pin those numbers so a retune fails here
 * instead of silently invalidating the comment.
 */
describe('the faint certification in tokens.ts', () => {
  // Precision 2 (±0.005), not 1 — a "pin" at ±0.05 is loose enough to hide the very drift it
  // claims to catch. The comment said "~4.98 on raise"; the true value is 4.97.
  it('matches the documented ratios', () => {
    expect(ratio(semantic.faint, CANVAS)).toBeCloseTo(5.35, 2);
    expect(ratio(semantic.faint, SURFACE)).toBeCloseTo(5.3, 2);
    expect(ratio(semantic.faint, RAISE)).toBeCloseTo(4.97, 2);
    expect(ratio(semantic.faint, RAISE2)).toBeCloseTo(4.69, 2);
  });

  it('and the bandAlt exclusion the comment calls out', () => {
    expect(ratio(semantic.faint, semantic.bandAlt)).toBeCloseTo(4.44, 2);
    expect(ratio(semantic.faint, semantic.bandAlt)).toBeLessThan(AA_NORMAL);
  });

  it('stays clearly below foregroundMuted, as the retune promised', () => {
    expect(ratio(semantic.foregroundMuted, CANVAS)).toBeCloseTo(7.34, 2);
    expect(luminance(semantic.faint)).toBeLessThan(luminance(semantic.foregroundMuted));
  });
});

/**
 * The hierarchy ladder (DESIGN §11, 2026-08-08). A metadata annotation must never outrank the
 * payload it labels. This ordering is why `Tag.quiet` cannot go below `foregroundMuted` and why
 * a `faint` payload had to be raised to `ink2` when the annotation landed above it.
 */
describe('the tone ladder', () => {
  const rung = (token: keyof typeof semantic) => luminance(semantic[token] as string);

  it('descends foreground > ink2 > foregroundMuted > faint', () => {
    expect(rung('foreground')).toBeGreaterThan(rung('ink2'));
    expect(rung('ink2')).toBeGreaterThan(rung('foregroundMuted'));
    expect(rung('foregroundMuted')).toBeGreaterThan(rung('faint'));
  });

  it('SuggestionRow reads handle > dream > marker on bg-raise', () => {
    const handle = ratio(semantic.foreground, RAISE); // 15.74
    const dream = ratio(semantic.ink2, RAISE); // 10.70
    const marker = ratio(semantic.foregroundMuted, NESTED); // 5.80 — in the pill
    expect(handle).toBeGreaterThan(dream);
    expect(dream).toBeGreaterThan(marker);
    for (const r of [handle, dream, marker]) expect(r).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('a quiet Tag only outranks a payload that is ink2 or brighter', () => {
    // Why IncomingOfferRow's message had to move faint → ink2, and why BenefitRow's locked
    // title (faint by STATE, not rank) is deliberately left inverted.
    expect(luminance(semantic.foregroundMuted)).toBeGreaterThan(luminance(semantic.faint));
    expect(luminance(semantic.ink2)).toBeGreaterThan(luminance(semantic.foregroundMuted));
  });
});

/**
 * The `inert` token rejected in DESIGN §11 was the pre-retune `faint`. Pinned because the
 * decisions log cites these numbers as part of the reasoning.
 */
describe('the rejected inert value #615A7E', () => {
  it('clears the 1.4.11 non-text floor on the canvas but not on a card', () => {
    expect(ratio('#615A7E', CANVAS)).toBeCloseTo(3.05, 1);
    expect(ratio('#615A7E', CANVAS)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(ratio('#615A7E', RAISE)).toBeCloseTo(2.84, 1);
    expect(ratio('#615A7E', RAISE)).toBeLessThan(AA_LARGE);
  });
});

/**
 * Sub-AA pairs that SHIP TODAY. Not guards, not hypotheticals — these are failures this module
 * found the moment it existed, pinned so they are tracked rather than rediscovered. Each one
 * needs a token or surface decision (rule #4), which is why they are recorded here instead of
 * being quietly "fixed" inside a refactor.
 *
 * The first draft of this block called them forward-looking guards. That was the module's own
 * mistake in miniature: a claim about a TOKEN standing in for a claim about SURFACES. Audited
 * afterwards, all three are live. Don't loosen these back into hypotheticals — resolve them.
 */
describe('sub-AA pairs that ship today (documented, not guarded)', () => {
  it('error clears on the canvas and on a card', () => {
    expect(ratio(semantic.error, CANVAS)).toBeGreaterThanOrEqual(AA_NORMAL); // 4.93 — modal bodies
    expect(ratio(semantic.error, RAISE)).toBeGreaterThanOrEqual(AA_NORMAL); // 4.58 — SettingsRow danger
  });

  it('FAILS: MilestoneRow delete, 15px error on a chip nested in a card', () => {
    // MilestoneRow.tsx:123 — `text-[15px] text-error` inside the kebab menu's bg-raise-2
    // (MilestoneRow.tsx:104), itself inside DreamCard's bg-raise. Normal-size text, floor 4.5.
    expect(ratio(semantic.error, NESTED)).toBeCloseTo(3.9, 2);
    expect(ratio(semantic.error, NESTED)).toBeLessThan(AA_NORMAL);
  });

  it('FAILS: SubscriptionStatusCard past-due, 13px error on the aura-soft card', () => {
    // SubscriptionStatusCard.tsx:89, inside the bg-aura-soft glow surface at :65.
    expect(ratio(semantic.error, AURA_SOFT)).toBeCloseTo(4.26, 2);
    expect(ratio(semantic.error, AURA_SOFT)).toBeLessThan(AA_NORMAL);
  });

  it('FAILS: the danger Button — onError on its own error fill', () => {
    // Button.tsx:17 `danger: { bg: 'bg-error', text: 'text-on-error' }`, shipped on the
    // account-deletion CTA at (modal)/delete-account.tsx:91. onError === foreground.
    expect(ratio(semantic.onError, semantic.error)).toBeCloseTo(3.44, 2);
    expect(ratio(semantic.onError, semantic.error)).toBeLessThan(AA_NORMAL);
  });

  it('aura and onAura are comfortable everywhere they are used', () => {
    for (const s of [CANVAS, SURFACE, RAISE, RAISE2, NESTED, AURA_SOFT]) {
      expect(ratio(semantic.aura, s)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
    expect(ratio(semantic.onAura, semantic.aura)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

// A cross-product of readable tokens against the standard surfaces — NOT a usage audit. It
// proves each pair would clear if it occurred, not that every occurrence is covered.
describe('readable tokens × standard surfaces', () => {
  const READABLE = ['foreground', 'ink2', 'foregroundMuted', 'faint'] as const;
  const SURFACES: [string, string][] = [
    ['canvas', CANVAS],
    ['surface', SURFACE],
    ['raise', RAISE],
    ['raise2', RAISE2],
    ['auraSoft', AURA_SOFT],
  ];

  it.each(READABLE)('%s would clear AA on canvas, surface, raise, raise2 and auraSoft', (token) => {
    for (const [name, surface] of SURFACES) {
      const r = ratio(semantic[token], surface);
      expect(r, `${token} on ${name} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it('but faint does NOT survive the nested chip — the one documented exclusion', () => {
    expect(ratio(semantic.faint, NESTED)).toBeLessThan(AA_NORMAL);
    for (const token of ['foreground', 'ink2', 'foregroundMuted'] as const) {
      expect(ratio(semantic[token], NESTED)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });
});
