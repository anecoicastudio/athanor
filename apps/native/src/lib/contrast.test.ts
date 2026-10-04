import { galleria } from '@athanor/config';
import { describe, expect, it } from 'vitest';
import { AA_LARGE, AA_NORMAL, luminance, over, ratio } from '@athanor/config/contrast';

/**
 * The surfaces text actually renders on. Since Galleria (2026-10-03, #921) the grounds are
 * opaque — a black stage, a charcoal block — so they are plain tokens: `over()` takes an
 * `rgba(…)` layer and throws on a hex one, and a composed constant up here would stop the whole
 * file from collecting. `auraSoft` is the one translucent surface left, so it is still composed
 * in render order, outermost backdrop last.
 *
 * `raise`, `raise2`, `auraSoft`, `faint`, `ink2` and `success` are legacy aliases carrying
 * interim values (`galleria` in packages/config/src/tokens.ts). A block below that is about one
 * of them states the interim truth, and is retired with the alias it is about — as the one
 * about `onError` was on 2026-10-04, when the filled danger button it inked became an outline.
 *
 * The arithmetic lives with the tokens, in packages/config/src/contrast.ts, and so do its own
 * tests and the web's pairs (`contrast.test.ts` there). This file is the app's surfaces.
 */
const CANVAS = galleria.background; // #000000 — the stage: screens, modals
const SURFACE = galleria.surface; // #1D1D1F — charcoal: grouped blocks, cards, sheets
const RAISE = galleria.raise; // #1D1D1F — a card / list row: the same charcoal as SURFACE
const RAISE2 = galleria.raise2; // #2C2C2E — the legacy chip fill, on the canvas or in a card
const AURA_SOFT = over(galleria.auraSoft, CANVAS); // #041515 — accent surface on the canvas
const AURA_SOFT_ON_RAISE = over(galleria.auraSoft, RAISE); // #1e2f31 — accent chip INSIDE a card

describe('over, on the app’s surfaces', () => {
  it('composes the one translucent surface Galleria still has', () => {
    // No Galleria surface is translucent twice over, so the chain itself (a chip inside a card)
    // is exercised with the dark world's stack in packages/config/src/contrast.test.ts.
    expect(AURA_SOFT).toBe('#041515');
    expect(AURA_SOFT_ON_RAISE).toBe('#1e2f31');
  });

  it('the interim ink2 is the foreground value, literally', () => {
    // `ink2` is a legacy alias of `foreground`; the literal is that value.
    expect(luminance('#F5F5F7')).toBeCloseTo(luminance(galleria.ink2), 10);
  });
});

/**
 * The pairs DESIGN.md §3 «Contrast — mobile» prints, recomputed from the tokens: two grounds,
 * the black stage and the charcoal block, and every text tone the look has on both.
 */
describe('the Galleria pairs (DESIGN.md §3)', () => {
  it.each([
    ['foreground', 19.29, 15.46],
    ['foregroundMuted', 5.8, 4.65],
    ['aura', 11.06, 8.86],
    ['error', 5.8, 4.65],
  ] as const)('%s clears AA on black and on charcoal', (token, onBlack, onCharcoal) => {
    expect(ratio(galleria[token], CANVAS)).toBeCloseTo(onBlack, 2);
    expect(ratio(galleria[token], SURFACE)).toBeCloseTo(onCharcoal, 2);
    expect(ratio(galleria[token], SURFACE)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('onAura is readable ink on a cyan fill — the celebration pill', () => {
    expect(ratio(galleria.onAura, galleria.aura)).toBeCloseTo(8.72, 2);
  });

  it('black on the white pill — the primary action, the selected chip, the own bubble', () => {
    expect(ratio(galleria.background, galleria.foreground)).toBeCloseTo(19.29, 2);
  });

  it('the web’s red would not have cleared charcoal, which is why mobile has its own', () => {
    // Ruled 2026-10-03: `#E0476B` stays the web's `semantic.error`; the app reads `#E5536F`.
    expect(ratio('#E0476B', SURFACE)).toBeCloseTo(4.23, 2);
    expect(ratio('#E0476B', SURFACE)).toBeLessThan(AA_NORMAL);
  });

  it('the hairline is decoration: it never carries meaning alone', () => {
    expect(ratio(galleria.hair, CANVAS)).toBeCloseTo(1.67, 2);
    expect(ratio(galleria.hair, CANVAS)).toBeLessThan(AA_LARGE);
  });
});

/**
 * The bug this module exists for. A `Tag` pill (`bg-raise-2`) inside a `SuggestionRow`
 * (`bg-raise`) did NOT sit on the surface the token comment certified: both were translucent
 * whites, and `faint` shipped there on the strength of a 4.69 figure that was really 4.23.
 *
 * Galleria closes that trap for the card and the chip — an opaque chip is one surface wherever
 * it sits — and leaves an interim failure in its place: `raise2` has to be lighter than
 * charcoal to stay visible inside a card, and the one secondary grey does not clear it.
 *
 * `Tag` itself left that surface on 2026-10-04: the Galleria tag is a hairline pill with no
 * fill (DESIGN §9), so its label reads on whatever the tag stands on.
 */
describe('the nested-surface trap (regression)', () => {
  it('is closed for the card and the chip: both are opaque', () => {
    // A translucent `raise`/`raise2` would make the backdrop depend on the nesting again, and
    // every figure in this file that names RAISE or RAISE2 would be a claim about a token.
    for (const token of [galleria.raise, galleria.raise2]) {
      expect(token).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('a quiet Tag has no fill: its grey reads on the stage and on a charcoal row', () => {
    // `components/Tag.tsx` draws a hairline and nothing behind the label (`source-audit` section
    // 50 holds that), so the pair is the grey on what the tag stands on: the stage under
    // `BenefitRow`, a `bg-raise` row in `SuggestionRow` and `IncomingOfferRow`.
    expect(ratio(galleria.foregroundMuted, CANVAS)).toBeCloseTo(5.8, 2);
    expect(ratio(galleria.foregroundMuted, RAISE)).toBeCloseTo(4.65, 2);
    expect(ratio(galleria.foregroundMuted, RAISE)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('INTERIM: the secondary grey is under AA on a chip — search, EventRow', () => {
    // Two sites set readable copy in `muted-foreground` on `bg-raise-2`:
    // `app/(modal)/search.tsx` and `components/live/EventRow.tsx`. Each stops when its screens
    // are converted (#921, open as of 2026-10-04); `Tag` (`quiet`) was the third until that
    // day. Charcoal would clear (4.65) but hides the unbordered blocks inside cards, so that
    // fill is a step lighter and this is the cost. A mark in the same grey on the same fill is
    // above the 3:1 non-text floor.
    expect(ratio(galleria.foregroundMuted, RAISE2)).toBeCloseTo(3.85, 2);
    expect(ratio(galleria.foregroundMuted, RAISE2)).toBeLessThan(AA_NORMAL);
    expect(ratio(galleria.foregroundMuted, RAISE2)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it('…and faint, the same grey in the interim, fails there with it', () => {
    expect(ratio(galleria.faint, RAISE2)).toBeCloseTo(3.85, 2);
    expect(ratio(galleria.faint, RAISE2)).toBeLessThan(AA_NORMAL);
  });
});

/**
 * `faint` was the dark world's tertiary tone, certified in prose beside `semantic.faint` in
 * packages/config/src/tokens.ts and pinned here against that world's surfaces. Galleria has ONE
 * secondary grey, so `galleria.faint` is a legacy alias of it; what is pinned now is that grey
 * on Galleria's surfaces.
 */
describe('the faint alias in galleria', () => {
  it('is the secondary grey, value for value', () => {
    expect(galleria.faint).toBe(galleria.foregroundMuted);
  });

  // Precision 2 (±0.005), not 1 — a "pin" at ±0.05 is loose enough to hide the very drift it
  // claims to catch.
  it('matches the ratios the secondary has on each surface', () => {
    expect(ratio(galleria.faint, CANVAS)).toBeCloseTo(5.8, 2);
    expect(ratio(galleria.faint, SURFACE)).toBeCloseTo(4.65, 2);
    expect(ratio(galleria.faint, RAISE)).toBeCloseTo(4.65, 2);
    expect(ratio(galleria.faint, RAISE2)).toBeCloseTo(3.85, 2);
  });

  // `border` is a legacy alias too (the hairline's value). No call site pairs the two; pinned so
  // that stays a decision, as it was for the dark world's #241B3A.
  it('and stays excluded from the border colour', () => {
    expect(ratio(galleria.faint, galleria.border)).toBeCloseTo(3.48, 2);
    expect(ratio(galleria.faint, galleria.border)).toBeLessThan(AA_NORMAL);
  });
});

/**
 * The hierarchy ladder (DESIGN §11, 2026-08-08). A metadata annotation must never outrank the
 * payload it labels. The dark world had four rungs; Galleria has two — text and one secondary —
 * and the two legacy rungs stand on them in the interim. So the ladder holds as «never above»,
 * not as «strictly below», and each equality here goes when its alias does.
 */
describe('the tone ladder', () => {
  const rung = (token: keyof typeof galleria) => luminance(galleria[token]);

  it('INTERIM: descends foreground = ink2 > foregroundMuted = faint', () => {
    expect(rung('foreground')).toBe(rung('ink2'));
    expect(rung('ink2')).toBeGreaterThan(rung('foregroundMuted'));
    expect(rung('foregroundMuted')).toBe(rung('faint'));
  });

  it('INTERIM: SuggestionRow reads handle = dream > marker on bg-raise', () => {
    const handle = ratio(galleria.foreground, RAISE); // 15.46
    const dream = ratio(galleria.ink2, RAISE); // 15.46 — ink2 is foreground for now
    // 4.65 — the quiet Tag has no fill since 2026-10-04, so its label is on the row itself.
    const marker = ratio(galleria.foregroundMuted, RAISE);
    expect(handle).toBe(dream);
    expect(dream).toBeGreaterThan(marker);
    for (const r of [handle, dream, marker]) expect(r).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('INTERIM: a quiet Tag ties a faint payload and never outranks an ink2 one', () => {
    // Why IncomingOfferRow's message had to move faint → ink2, and why BenefitRow's locked
    // title (faint by STATE, not rank) is deliberately left inverted. With one secondary grey
    // the annotation can no longer be brighter than a faint payload — only level with it.
    expect(luminance(galleria.foregroundMuted)).toBe(luminance(galleria.faint));
    expect(luminance(galleria.ink2)).toBeGreaterThan(luminance(galleria.foregroundMuted));
  });
});

/**
 * The `inert` token rejected in DESIGN §11 was the pre-retune `faint`. Pinned because the
 * decisions log cites these numbers as part of the reasoning. They are figures about the dark
 * world, so its canvas and card are written out: the app has not read that palette since
 * 2026-10-03.
 */
describe('the rejected inert value #615A7E', () => {
  const DARK_CANVAS = '#0A0A1A';
  const DARK_CARD = over('rgba(255,255,255,0.04)', DARK_CANVAS); // #141423

  it('clears the 1.4.11 non-text floor on the canvas but not on a card', () => {
    expect(ratio('#615A7E', DARK_CANVAS)).toBeCloseTo(3.05, 1);
    expect(ratio('#615A7E', DARK_CANVAS)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(ratio('#615A7E', DARK_CARD)).toBeCloseTo(2.84, 1);
    expect(ratio('#615A7E', DARK_CARD)).toBeLessThan(AA_LARGE);
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
 *   - MilestoneRow's kebab menu went `bg-raise-2` → opaque `bg-surface`, so it no longer sat on
 *     a chip inside DreamCard's `bg-raise`.
 *   - SubscriptionStatusCard's past-due warning moved OUT of the aura-soft glow card onto the
 *     modal canvas.
 *   - `onError` went `#F0EDF7` → `#1A050D`. The filled danger button it inked became an
 *     outline on 2026-10-04 and the token left with it: the destructive pill is certified below.
 *   - DateBadge's month label switched to `muted-foreground` when highlighted — found only
 *     after this block existed, because `AURA_SOFT` was composed over the canvas and nothing
 *     modelled an accent chip inside a card. Hence `AURA_SOFT_ON_RAISE`.
 *
 * So these are guards — but only because the sites moved, NOT because the pairs got safe. The
 * figures are Galleria's since 2026-10-03: `error` on a chip is 3.85 and on aura-soft inside a
 * card 3.85. If a new call site puts them together it is just as broken as before. Don't read
 * a passing test as permission.
 */
describe('forbidden pairs — no call site may use these', () => {
  it('error clears on the canvas and on a card — the surfaces it IS used on', () => {
    expect(ratio(galleria.error, CANVAS)).toBeGreaterThanOrEqual(AA_NORMAL); // 5.80 — modal bodies, Circle past-due
    expect(ratio(galleria.error, RAISE)).toBeGreaterThanOrEqual(AA_NORMAL); // 4.65 — `raise`, the legacy alias of the same charcoal
    expect(ratio(galleria.error, SURFACE)).toBeGreaterThanOrEqual(AA_NORMAL); // 4.65 — a destructive Row, MilestoneRow menu
  });

  it('error on a chip stays unusable (was MilestoneRow, now bg-surface)', () => {
    expect(ratio(galleria.error, RAISE2)).toBeCloseTo(3.85, 2);
    expect(ratio(galleria.error, RAISE2)).toBeLessThan(AA_NORMAL);
  });

  it('error on aura-soft clears on the black canvas, and that is not permission', () => {
    // It was 4.26 on the dark world's canvas, which is why the Circle past-due warning left the
    // glow card. On black it clears — and inside a card, the next assertion, it does not.
    expect(ratio(galleria.error, AURA_SOFT)).toBeCloseTo(5.16, 2);
    expect(ratio(galleria.error, AURA_SOFT)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('and an accent chip nested in a card is unusable for error and for faint', () => {
    // The gap that let DateBadge's `faint` month label ship at 4.17: `AURA_SOFT` alone is
    // aura-soft over the CANVAS, but an accent chip inside a card composites over `raise`.
    // Same surface-not-token lesson as the nested chip, one accent surface later.
    // The in-repo `over()` is authoritative for the composite: a scratch implementation that
    // rounds half-to-even instead of half-up shifts a channel by 1 and the ratio with it.
    expect(ratio(galleria.error, AURA_SOFT_ON_RAISE)).toBeCloseTo(3.85, 2);
    expect(ratio(galleria.error, AURA_SOFT_ON_RAISE)).toBeLessThan(AA_NORMAL);
    expect(ratio(galleria.faint, AURA_SOFT_ON_RAISE)).toBeCloseTo(3.85, 2);
    expect(ratio(galleria.faint, AURA_SOFT_ON_RAISE)).toBeLessThan(AA_NORMAL);
  });

  it('INTERIM: muted-foreground no longer survives an accent chip in a card — DateBadge', () => {
    // What `components/live/DateBadge.tsx` switches its month label to when `highlight` is set,
    // inside EventRow's `bg-raise`. It was 5.72 there in the dark world. With one secondary grey
    // and `auraSoft` unchanged it is 3.85, and it stays so until the Live screens are converted
    // (#921, open as of 2026-10-03). The day number above it is `aura`, which clears.
    expect(ratio(galleria.foregroundMuted, AURA_SOFT_ON_RAISE)).toBeCloseTo(3.85, 2);
    expect(ratio(galleria.foregroundMuted, AURA_SOFT_ON_RAISE)).toBeLessThan(AA_NORMAL);
    expect(ratio(galleria.foregroundMuted, AURA_SOFT_ON_RAISE)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(ratio(galleria.aura, AURA_SOFT_ON_RAISE)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('…while on aura-soft over the canvas the secondary clears', () => {
    // An accent surface straight on the stage, with no card under it.
    expect(ratio(galleria.foregroundMuted, AURA_SOFT)).toBeCloseTo(5.16, 2);
    expect(ratio(galleria.foregroundMuted, AURA_SOFT)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('light text on an error FILL stays unusable', () => {
    // The pair a filled destructive button would draw if it came back with a light label
    // (`foreground` is #F5F5F7). No surface fills with `error` today; pinned so that revert is
    // visibly a regression.
    expect(ratio(galleria.foreground, galleria.error)).toBeCloseTo(3.33, 2);
    expect(ratio(galleria.foreground, galleria.error)).toBeLessThan(AA_NORMAL);
  });

  it('the destructive pill — error ink and border, no fill, on the stage', () => {
    // Button.tsx `VARIANT_CLASSES.destructive` is an outline: `error` on the label and on the
    // 1px border, nothing behind them. Its one call site is the account-deletion CTA in
    // (modal)/delete-account.tsx, which stands on the canvas. The label needs AA; the border is
    // a boundary and needs the 3:1 non-text floor, which the same figure clears.
    expect(ratio(galleria.error, CANVAS)).toBeCloseTo(5.8, 2);
    expect(ratio(galleria.error, CANVAS)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('the outline pill — its grey border is a boundary on the stage and on a block', () => {
    // Button.tsx `VARIANT_CLASSES.outline`: a 1px `foregroundMuted` border, foreground label.
    expect(ratio(galleria.foregroundMuted, CANVAS)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(ratio(galleria.foregroundMuted, SURFACE)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it('the Apple Sign-In button — black ink on its HIG-mandated white fill', () => {
    // Button.tsx `VARIANT_CLASSES.apple` = { bg: 'apple-button-bg', text: 'apple-button-ink' },
    // welcome.tsx's Apple CTA only. Pure white/black, not Athanor's near-white/near-black roles
    // (ruled 2026-09-19 on #79) — trivially AA, asserted for the same reason the two other
    // filled variants are (`primary` and `celebration`, in the Galleria pairs above): a retune
    // here should fail a test, not just look wrong on a phone.
    expect(ratio(galleria.appleButtonInk, galleria.appleButtonBg)).toBeGreaterThanOrEqual(
      21 - 0.01,
    );
  });

  it('success clears AA where it marks a satisfied rule', () => {
    // The signup password checklist ((auth)/welcome.tsx) is the newest call site. `success` is
    // a legacy alias: mobile has no green (ruled 2026-10-03), and the value stays only while
    // its sites are unconverted.
    expect(ratio(galleria.success, CANVAS)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(ratio(galleria.success, RAISE)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('aura and onAura are comfortable everywhere they are used', () => {
    for (const s of [CANVAS, SURFACE, RAISE, RAISE2, AURA_SOFT, AURA_SOFT_ON_RAISE]) {
      expect(ratio(galleria.aura, s)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
    expect(ratio(galleria.onAura, galleria.aura)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

// A cross-product of readable tokens against the standard surfaces — NOT a usage audit. It
// proves each pair would clear if it occurred, not that every occurrence is covered.
describe('readable tokens × standard surfaces', () => {
  const SURFACES: [string, string][] = [
    ['canvas', CANVAS],
    ['surface', SURFACE],
    ['raise', RAISE],
    ['raise2', RAISE2],
    ['auraSoft', AURA_SOFT],
  ];

  it.each(['foreground', 'ink2'] as const)(
    '%s would clear AA on canvas, surface, raise, raise2 and auraSoft',
    (token) => {
      for (const [name, surface] of SURFACES) {
        const r = ratio(galleria[token], surface);
        expect(r, `${token} on ${name} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(AA_NORMAL);
      }
    },
  );

  // INTERIM: the secondary grey and its alias clear every standard surface but the chip.
  it.each(['foregroundMuted', 'faint'] as const)(
    '%s would clear AA on canvas, surface, raise and auraSoft — not on raise2',
    (token) => {
      for (const [name, surface] of SURFACES) {
        const r = ratio(galleria[token], surface);
        if (name === 'raise2') {
          expect(r, `${token} on ${name} = ${r.toFixed(2)}`).toBeLessThan(AA_NORMAL);
        } else {
          expect(r, `${token} on ${name} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(AA_NORMAL);
        }
      }
    },
  );

  // The secondary is the bottom rung, so it is the tone that runs out first. Three surfaces are
  // where it does, and calling any of them "the one exclusion" was wrong — there are three.
  // Composed and lifted surfaces are where the floor gets crossed; keep this list honest.
  it.each([
    ['a chip (RAISE2)', () => RAISE2],
    ['an accent chip nested in a card (AURA_SOFT_ON_RAISE)', () => AURA_SOFT_ON_RAISE],
    ['border', () => galleria.border],
  ])('the secondary does NOT survive %s', (_label, surface) => {
    expect(ratio(galleria.foregroundMuted, surface())).toBeLessThan(AA_NORMAL);
    expect(ratio(galleria.faint, surface())).toBeLessThan(AA_NORMAL);
  });

  it('…and the two text tones above it do survive the chip and the accent chip', () => {
    for (const token of ['foreground', 'ink2'] as const) {
      expect(ratio(galleria[token], RAISE2)).toBeGreaterThanOrEqual(AA_NORMAL);
      expect(ratio(galleria[token], AURA_SOFT_ON_RAISE)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });
});
