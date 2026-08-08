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
const AURA_SOFT = over(semantic.auraSoft, CANVAS); // #0D1E2C — accent surface on the canvas
const AURA_SOFT_ON_RAISE = over(semantic.auraSoft, RAISE); // #162734 — accent chip INSIDE a card

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
 * Forbidden pairs — ratios that exist in the palette but that NO call site may use.
 *
 * Read the history before touching this block, because its framing has been wrong once. The
 * first draft called these forward-looking guards while three call sites were live: that was
 * this module's own mistake in miniature, a claim about a TOKEN standing in for a claim about
 * SURFACES. They were then re-labelled as shipping failures, which was true, and finally fixed:
 *
 *   - MilestoneRow's kebab menu went `bg-raise-2` → opaque `bg-surface` (3.90 → 4.88), so it no
 *     longer composites over DreamCard's `bg-raise`.
 *   - SubscriptionStatusCard's past-due warning moved OUT of the aura-soft glow card onto the
 *     modal canvas (4.26 → 4.93).
 *   - `onError` went `#F0EDF7` → `#1A050D` (3.44 → 4.93); that one asserts its PASS below.
 *   - DateBadge's month label switched to `muted-foreground` when highlighted (4.17 → 5.72) —
 *     found only after this block existed, because `AURA_SOFT` was composed over the canvas and
 *     nothing modelled an accent chip inside a card. Hence `AURA_SOFT_ON_RAISE`.
 *
 * So these are guards now — but only because the sites moved, NOT because the pairs got safe.
 * `error` on a nested chip is still 3.90 and on aura-soft still 4.26. If a new call site puts
 * them together it is just as broken as before. Don't read a passing test as permission.
 */
describe('forbidden pairs — no call site may use these', () => {
  it('error clears on the canvas and on a card — the surfaces it IS used on', () => {
    expect(ratio(semantic.error, CANVAS)).toBeGreaterThanOrEqual(AA_NORMAL); // 4.93 — modal bodies, Circle past-due
    expect(ratio(semantic.error, RAISE)).toBeGreaterThanOrEqual(AA_NORMAL); // 4.58 — SettingsRow danger
    expect(ratio(semantic.error, SURFACE)).toBeGreaterThanOrEqual(AA_NORMAL); // 4.88 — MilestoneRow menu
  });

  it('error on a chip nested in a card stays unusable (was MilestoneRow, now bg-surface)', () => {
    expect(ratio(semantic.error, NESTED)).toBeCloseTo(3.9, 2);
    expect(ratio(semantic.error, NESTED)).toBeLessThan(AA_NORMAL);
  });

  it('error on aura-soft stays unusable (was the Circle past-due warning, now on the canvas)', () => {
    expect(ratio(semantic.error, AURA_SOFT)).toBeCloseTo(4.26, 2);
    expect(ratio(semantic.error, AURA_SOFT)).toBeLessThan(AA_NORMAL);
  });

  it('and an accent chip nested in a card is worse still', () => {
    // The gap that let DateBadge's `faint` month label ship at 4.17: `AURA_SOFT` alone is
    // aura-soft over the CANVAS, but an accent chip inside a card composites over `raise`.
    // Same surface-not-token lesson as NESTED, one accent surface later.
    // 3.84, not the 3.85 quoted while this was being investigated: that figure came from a
    // scratch implementation using Python's round() (banker's rounding) where JS Math.round is
    // half-up, shifting a composited channel by 1. The in-repo `over()` is authoritative.
    expect(ratio(semantic.error, AURA_SOFT_ON_RAISE)).toBeCloseTo(3.84, 2);
    expect(ratio(semantic.error, AURA_SOFT_ON_RAISE)).toBeLessThan(AA_NORMAL);
    expect(ratio(semantic.faint, AURA_SOFT_ON_RAISE)).toBeCloseTo(4.17, 2);
    expect(ratio(semantic.faint, AURA_SOFT_ON_RAISE)).toBeLessThan(AA_NORMAL);
  });

  it('muted-foreground is the tone that survives an accent chip in a card', () => {
    // What DateBadge.tsx switches to when `highlight` is set.
    expect(ratio(semantic.foregroundMuted, AURA_SOFT_ON_RAISE)).toBeCloseTo(5.72, 2);
    expect(ratio(semantic.foregroundMuted, AURA_SOFT_ON_RAISE)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('the old near-white onError stays unusable on the error fill', () => {
    // The exact value `onError` used to hold. Pinned so the revert is visibly a regression.
    expect(ratio(semantic.foreground, semantic.error)).toBeCloseTo(3.44, 2);
    expect(ratio(semantic.foreground, semantic.error)).toBeLessThan(AA_NORMAL);
  });

  it('PASSES NOW: the danger Button — dark onError on its error fill', () => {
    // Button.tsx `VARIANT_CLASSES.danger` = { bg: 'bg-error', text: 'text-on-error' }, on the
    // account-deletion CTA in (modal)/delete-account.tsx. Every filled variant is
    // dark-ink-on-light-fill. (Symbols, not line numbers: adding four comment lines to Button
    // moved this one, in the very module that exists because a claim drifted from its code.)
    expect(ratio(semantic.onError, semantic.error)).toBeCloseTo(4.93, 2);
    expect(ratio(semantic.onError, semantic.error)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('success clears AA where it marks a satisfied rule', () => {
    // The signup password checklist ((auth)/welcome.tsx) is the newest call site:
    // `success` for a met requirement, deliberately not `aura` — a form rule going
    // green is a confirmation, not a moment (rule 4).
    expect(ratio(semantic.success, CANVAS)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(ratio(semantic.success, RAISE)).toBeGreaterThanOrEqual(AA_NORMAL);
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

  // `faint` is the bottom rung, so it is the token that runs out first. Three surfaces above
  // are NOT in the list, and calling any of them "the one exclusion" was wrong — there are
  // three. Composed surfaces are where the floor gets crossed; keep this list honest.
  it.each([
    ['a chip nested in a card (NESTED)', () => NESTED],
    ['an accent chip nested in a card (AURA_SOFT_ON_RAISE)', () => AURA_SOFT_ON_RAISE],
    ['bandAlt / border', () => semantic.bandAlt],
  ])('faint does NOT survive %s', (_label, surface) => {
    expect(ratio(semantic.faint, surface())).toBeLessThan(AA_NORMAL);
  });

  it('…and the three tones above it do survive the nested chip', () => {
    for (const token of ['foreground', 'ink2', 'foregroundMuted'] as const) {
      expect(ratio(semantic[token], NESTED)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });
});
