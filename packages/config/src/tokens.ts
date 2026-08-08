/**
 * Athanor design tokens — single source of truth for both Tailwind setups
 * (web Tailwind 4 @theme, mobile NativeWind config). Never use literal hex
 * in app code; import from here. Semantic role names only — the palette
 * (ATHANOR Concept Document §18) is expressed through roles, not color names.
 *
 * Brand rule (M0.5): `aura` (the cyan light, #2BD0D2) is the action + meaning
 * color — CTAs, send, the kairos ✦, live, countdown, lit stars. Reserve the
 * GLOW for moment-grade events (waiting Momento, lit star, dream helped, match).
 * The mandala gradient (magenta → violet → indigo) is the logo/hero ring only.
 */

export const semantic = {
  background: '#0A0A1A', // the deep cosmic canvas
  surface: '#100A1C', // background lifted one step, violet-tinted — cards, sheets
  surfaceMuted: '#04030A', // background recessed — tab bar, scrims
  foreground: '#F0EDF7', // cool near-white — text on dark
  foregroundMuted: '#9A9DB5', // foreground dimmed — secondary text
  aura: '#2BD0D2', // glowing cyan — the light; action + meaning, glow = moments
  border: '#241B3A', // violet hairline
  bandAlt: '#241B3A', // alternate band — muted violet, section striping
  inkOnLight: '#0A0A1A', // text on rare light chips/print
  inkMutedOnLight: '#5C6478', // secondary on light chips/print
  success: '#36B37E', // confirmations, check-in OK (emerald — distinct from aura)
  error: '#E0476B', // input error ring, destructive (raspberry — rose family)
  ink2: '#C9C3DE', // body copy on dark — softer than foreground
  // tertiary / quiet labels. ~5.35:1 on background, ~5.30 on surface, ~4.97 on
  // raise, ~4.69 on raise2 — every surface it is actually used on clears AA.
  // (It would NOT on bandAlt/border #241B3A ≈4.44; nothing pairs them today.)
  // These ratios are ASSERTED, not just claimed: apps/native/src/lib/contrast.test.ts
  // recomputes them from these values, so a retune here fails there. Note each figure
  // names a SURFACE — `raise`/`raise2` are translucent, so a chip nested inside a card
  // is a different (darker-backed) stack than the same chip on the canvas, and `faint`
  // does NOT clear AA there (4.23). Compose surfaces with contrast.ts `over()`.
  // Was #615A7E (3.05 / 2.84), which DESIGN.md §3 never contrast-certified while
  // ~150 call sites used it for readable copy. Retuned at the token so they all
  // clear at once and no new call site can regress back. See DESIGN.md §12.
  faint: '#8781A8',
  raise: 'rgba(255,255,255,0.04)', // a lifted surface (card/list)
  raise2: 'rgba(255,255,255,0.065)', // higher surface (chips, quiet buttons)
  hair: 'rgba(176,158,222,0.10)', // translucent violet hairline
  auraSoft: 'rgba(43,208,210,0.10)', // moment fill / active accent chip
  auraLine: 'rgba(43,208,210,0.40)', // moment / accent 1px inset border
  onAura: '#04222a', // text inverted on a cyan fill
  // text on an error-colored surface. A dark rose ink, mirroring onAura's "near-black tinted
  // with the accent's own hue" — 4.93:1 on `error`. Was #F0EDF7 (identical to `foreground`),
  // which is 3.44:1 and shipped below AA on the account-deletion CTA. `error` itself can't move
  // to fix that: darkening the fill enough for white (#C4324F, 4.64) drops `text-error` on the
  // canvas to 3.66 and breaks the ~26 sites that use it as text. One token, two roles — the
  // fill stays put and the ink changes. Asserted in apps/native/src/lib/contrast.test.ts.
  onError: '#1A050D',
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

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 40,
  '2xl': 64,
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
