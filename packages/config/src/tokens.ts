/**
 * Auria design tokens — single source of truth for both Tailwind setups
 * (web Tailwind 4 @theme, mobile NativeWind config). Never use literal hex
 * in app code; import from here. Semantic role names only — the palette
 * (AURIA Concept Document §18) is expressed through roles, not color names.
 *
 * Brand rule (M0.5): `aura` (the cyan light, #2BD0D2) is the action + meaning
 * color — CTAs, send, the kairos ✦, live, countdown, lit stars. Reserve the
 * GLOW for moment-grade events (waiting Momento, lit star, dream helped, match).
 * The mandala gradient (magenta → violet → indigo) is the logo/hero ring only.
 */

export const semantic = {
  background: '#000206', // the deep cosmic canvas
  surface: '#100A1C', // background lifted one step, violet-tinted — cards, sheets
  surfaceMuted: '#04030A', // background recessed — tab bar, scrims
  foreground: '#ECEEF6', // cool near-white — text on dark
  foregroundMuted: '#9A9DB5', // foreground dimmed — secondary text
  aura: '#2BD0D2', // glowing cyan — the light; action + meaning, glow = moments
  border: '#241B3A', // violet hairline
  bandAlt: '#241B3A', // alternate band — muted violet, section striping
  inkOnLight: '#000206', // text on rare light chips/print
  inkMutedOnLight: '#5C6478', // secondary on light chips/print
  success: '#36B37E', // confirmations, check-in OK (emerald — distinct from aura)
  error: '#E0476B', // input error ring, destructive (raspberry — rose family)
} as const;

/** Mandala gradient — logo + hero ring ONLY. Not a UI accent. */
export const gradient = {
  1: '#7D236E', // magenta
  2: '#672088', // violet
  3: '#223D86', // indigo
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
} as const;

/**
 * Warm grotesque, weights 300–800 (M0.5: prototype set, was 400/600 only).
 * Dream register = Hanken italic (weight 400 italic); the Instrument Serif plan
 * is dropped (DESIGN.md §4). The font-load + `--font-dream` code swap is Part B
 * of the M0.5 gate — serifFamily stays here until that lands.
 */
export const typography = {
  fontFamily: 'Hanken Grotesk',
  serifFamily: 'Instrument Serif', // M0.5 Part B: replace with Hanken italic dream register
  weights: { light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800 },
  /** Display wordmark (letter-spaced). Plain "Auria" in body text and SEO. */
  wordmark: 'A U R I A',
} as const;

export type Semantic = typeof semantic;
export type Gradient = typeof gradient;
