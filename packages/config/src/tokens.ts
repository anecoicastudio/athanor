/**
 * Athanor design tokens — the single source both stylesheets mirror (web `app/globals.css`,
 * mobile `src/global.css`; a mirror test in each app holds its stylesheet to this file). Never
 * use literal hex in app code; import from here. Role names only — a colour is named by what
 * it does, never by what it looks like.
 *
 * Two looks, one file (Marco's ruling, 2026-10-03; docs/DESIGN.md §3 and §11):
 *
 * - `semantic` is the WEB's dark world, the palette of the ATHANOR Concept Document §18.
 *   `aura` (the cyan light, #2BD0D2) is its action + meaning colour — CTAs, the ✦ mark, live,
 *   countdown — and the GLOW is reserved for moment-grade events. Its key set is pinned by
 *   apps/web/lib/tokens-mirror.test.ts: never add, remove or retune a key for the app's sake.
 *   The keys that test lists under `NOT_ON_WEB` were the app's: no screen draws with them now.
 * - `galleria` is the MOBILE app: a black stage, charcoal blocks, a white primary pill. The
 *   same cyan is a small mark there and nothing else. apps/native reads `galleria`, never
 *   `semantic`.
 * - `broadsheet` is the web landing's palette, and only the landing's.
 *
 * The mandala gradient (magenta → violet → indigo) is the logo / hero ring only, in every look.
 */

export const semantic = {
  background: '#0A0A1A', // the deep cosmic canvas
  surface: '#100A1C', // background lifted one step, violet-tinted — cards, sheets
  surfaceMuted: '#04030A', // background recessed — tab bar, scrims
  foreground: '#F0EDF7', // cool near-white — text on dark
  foregroundMuted: '#9A9DB5', // foreground dimmed — secondary text
  aura: '#2BD0D2', // glowing cyan — the light; action + meaning, glow = moments
  border: '#241B3A', // violet hairline
  success: '#36B37E', // confirmations, check-in OK (emerald — distinct from aura)
  error: '#E0476B', // input error ring, destructive (raspberry — rose family)
  ink2: '#C9C3DE', // body copy on dark — softer than foreground
  // tertiary / quiet labels. ~5.35:1 on background, ~5.30 on surface, ~4.97 on
  // raise, ~4.69 on raise2 — every surface it is actually used on clears AA.
  // (It would NOT on border #241B3A ≈4.44; nothing pairs them today.)
  // These ratios were ASSERTED, not just claimed, while the app read this palette:
  // apps/native/src/lib/contrast.test.ts recomputed them from these values until 2026-10-03,
  // when it moved to `galleria` (#921). Nothing recomputes them now. Note each figure
  // names a SURFACE — `raise`/`raise2` are translucent, so a chip nested inside a card
  // is a different (darker-backed) stack than the same chip on the canvas, and `faint`
  // does NOT clear AA there (4.23). Compose surfaces with contrast.ts `over()`.
  // Was #615A7E (3.05 / 2.84), which DESIGN.md §3 never contrast-certified while
  // ~150 call sites used it for readable copy. Retuned at the token so they all
  // clear at once and no new call site can regress back. See DESIGN.md §11 (2026-08-07).
  faint: '#8781A8',
  raise: 'rgba(255,255,255,0.04)', // a lifted surface (card/list)
  raise2: 'rgba(255,255,255,0.065)', // higher surface (chips, quiet buttons)
  hair: 'rgba(176,158,222,0.10)', // translucent violet hairline
  auraSoft: 'rgba(43,208,210,0.10)', // active/selected fill; a moment only under auraGlow()
  auraLine: 'rgba(43,208,210,0.40)', // active/selected 1px inset border
  onAura: '#04222a', // text inverted on a cyan fill
  // text on an error-colored surface. A dark rose ink, mirroring onAura's "near-black tinted
  // with the accent's own hue" — 4.93:1 on `error`. Was #F0EDF7 (identical to `foreground`),
  // which is 3.44:1 and shipped below AA on the account-deletion CTA. `error` itself can't move
  // to fix that: darkening the fill enough for white (#C4324F, 4.64) drops `text-error` on the
  // canvas to 3.66 and breaks the ~26 sites that use it as text. One token, two roles — the
  // fill stays put and the ink changes. Asserted in apps/native/src/lib/contrast.test.ts until
  // 2026-10-03, when that file moved to `galleria`.
  onError: '#1A050D',
  // Apple's HIG "white" Sign in with Apple button — mandated fill + ink, ruled 2026-09-19 on
  // #79 (replaces the generic `outline` pill for the Apple CTA only). Pure white/black rather
  // than the app's near-white/near-black roles: this is a platform requirement independent of
  // Athanor's own dark-world palette, the same reasoning that keeps `provider-marks.tsx`'s
  // vendor hexes out of the token set — except a plain fill (unlike a brand mark) is ordinary
  // enough to model as a token pair rather than a carve-out.
  appleButtonBg: '#FFFFFF',
  appleButtonInk: '#000000',
} as const;

/**
 * Galleria — the mobile app's palette (Marco's ruling, 2026-10-03; docs/DESIGN.md §3 «Mobile»
 * and §11). A black stage with charcoal grouped blocks, one grey for everything secondary, a
 * white primary pill. On a converted screen cyan is a small mark — the waiting-Momento dot, the
 * member's own Aura numeral, «✦ Un passo del percorso», the countdown seconds, the celebration
 * screens — never an action colour, a selected state or a glow, and nothing is green: `success`
 * below is a legacy alias. A screen not yet converted still shows the old uses, and no test
 * holds this paragraph before the last screens convert (#921, open as of 2026-10-03).
 *
 * The ratios are ASSERTED, not just claimed: apps/native/src/lib/contrast.test.ts recomputes
 * them from these values, so a retune here fails there.
 *
 * It answers to every key `semantic` has. The screens are converted section by section (#921,
 * open as of 2026-10-03), and a screen that has not been converted still asks for the dark
 * world's roles. The roles Galleria has no counterpart for are the LEGACY ALIASES at the end,
 * each marked `@deprecated` and holding an interim value that keeps a half-converted app
 * legible. They serve the screens not yet converted; each is deleted with its last call site.
 * Nothing counts their reads: `@deprecated` is an editor hint, not a gate.
 */
export const galleria = {
  background: '#000000', // the stage — the ground of every screen, and the tab bar
  surface: '#1D1D1F', // charcoal — grouped blocks, the card, inputs, incoming bubbles
  hair: '#333336', // hairlines — between rows, around the card and a chip, above the tab bar
  foreground: '#F5F5F7', // text; and the white fills — primary pill, selected chip, own bubble
  foregroundMuted: '#86868B', // the ONE secondary — labels, placeholders, the outline pill's border
  aura: '#2BD0D2', // the small mark — the one value both looks share
  onAura: '#04222A', // ink on a cyan fill — the celebration pill's label
  // Error text, an invalid field's border, the destructive outline pill. A mobile value: the
  // web's #E0476B reads 4.23:1 on charcoal, under AA for text (ruled 2026-10-03).
  error: '#E5536F',
  // Apple's mandated Sign in with Apple fill and ink — a vendor rule, not a role. The reasoning
  // is beside the same pair in `semantic`.
  appleButtonBg: '#FFFFFF',
  appleButtonInk: '#000000',

  /** @deprecated Legacy alias — a card is `surface`. */
  raise: '#1D1D1F',
  /**
   * @deprecated Legacy alias, and the one interim colour of its own: a step lighter than
   * charcoal, so a chip inside a card stays visible. `foregroundMuted` is 3.85:1 on it — an
   * interim failure contrast.test.ts names, with the sites that carry it.
   */
  raise2: '#2C2C2E',
  /**
   * @deprecated Legacy alias — `surface`. It fills the Avatar fallback disc, the tab bar and
   * the scrim of the hand-rolled sheets; black would lose the disc on the stage.
   */
  surfaceMuted: '#1D1D1F',
  /** @deprecated Legacy alias — body copy is `foreground`. */
  ink2: '#F5F5F7',
  /** @deprecated Legacy alias — Galleria has one secondary, `foregroundMuted`. */
  faint: '#86868B',
  /** @deprecated Legacy alias — the hairline is `hair`. */
  border: '#333336',
  /** @deprecated Legacy alias, `semantic`'s value: the framed cyan surface, where one remains. */
  auraSoft: 'rgba(43,208,210,0.10)',
  /** @deprecated Legacy alias, `semantic`'s value: the 1px cyan border of that surface. */
  auraLine: 'rgba(43,208,210,0.40)',
  /** @deprecated Legacy alias, `semantic`'s value: ink on the filled danger button. */
  onError: '#1A050D',
  /**
   * @deprecated Legacy alias, `semantic`'s value. Mobile has no green: a confirmation is a ✓
   * and words.
   */
  success: '#36B37E',
} as const;

/** Mandala gradient — logo + hero ring ONLY. Not a UI accent. */
export const gradient = {
  1: '#7D236E', // magenta
  2: '#672088', // violet
  3: '#223D86', // indigo
} as const;

/**
 * Mandorla mark colors — the animated splash glyph (the two-circle vesica + lens,
 * prototype §9). Brand-mark only, never a UI fill. Cyan parts reuse `aura` with
 * opacity; these are the non-cyan mark colors (the violet circle hairline + the
 * lens depth gradient) that have no semantic role elsewhere.
 */
export const mandorla = {
  circle: '#A08CD2', // the two overlapping circles' violet hairline (drawn @ ~.35)
  lensTop: '#3A1F63', // lens fill gradient — top (violet)
  lensBottom: '#13234D', // lens fill gradient — bottom (indigo)
} as const;

/**
 * Broadsheet — the web LANDING's palette, and only the landing's (Marco's rulings, 2026-10-03:
 * two editorial references blended; docs/DESIGN.md §6 «Web landing» + §11). A painted wall, not
 * the dark world: a concrete canvas, near-black iron, and one violet that takes whole bands.
 * Violet is a SURFACE and a headline colour, never a button fill; there is no second accent,
 * so `aura` does not appear on that page at all. Nothing in apps/native reads these.
 */
export const broadsheet = {
  concrete: '#D9D9D9', // the page canvas — a neutral material grey
  iron: '#1F1F1F', // text, hairlines, pill fills — near-black, softer than #000 on concrete
  // Full-bleed bands, wall headings, icon strokes. The mandala's middle stop (`gradient[2]`),
  // and the one place a mandala colour is a UI surface — on `/` only, by the same ruling.
  violet: '#672088',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 40,
  '2xl': 64,
  /** Screen horizontal padding, DESIGN.md §6 — the one mobile spacing rule the doc states. */
  gutter: 20,
} as const;

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  full: 9999,
  ctl: 14, // buttons / inputs
  card: 20, // cards (== existing lg; kept named for the prototype scale)
  hero: 26, // hero blocks, media, sheet tops
} as const;

/**
 * Warm grotesque, weights 300–800 (prototype set). Dream register = Hanken
 * italic (weight 400 italic) — one family, no second face; Instrument Serif is
 * dropped (DESIGN.md §4). (The web landing uses EB Garamond for its display +
 * dream register — a separate, user-directed landing decision.)
 */
export const typography = {
  fontFamily: 'Hanken Grotesk',
  dreamRegister: 'Hanken Grotesk italic',
  weights: { light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800 },
  /** Display wordmark (letter-spaced). Plain "Athanor" in body text and SEO. */
  wordmark: 'A T H A N O R',
} as const;

export type Semantic = typeof semantic;
export type Gradient = typeof gradient;
