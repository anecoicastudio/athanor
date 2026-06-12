/**
 * Kaira design tokens — single source of truth for both Tailwind setups
 * (web Tailwind 4 @theme, mobile NativeWind config). Never use literal hex
 * in app code; import from here.
 *
 * Brand rule: oro (Kairos gold) is reserved for moments that matter —
 * a new Momento, a dream helped, a star lit. Never decorative.
 */

export const colors = {
  bluNotte: '#16243D',
  avorio: '#FAF7F0',
  oro: '#C9A227',
} as const;

export const semantic = {
  background: colors.bluNotte,
  surface: '#1E2F4F', // blu notte lightened one step — cards, sheets
  surfaceMuted: '#0F1A2E', // blu notte darkened — recessed areas
  foreground: colors.avorio,
  foregroundMuted: '#C9C4B8', // avorio dimmed — secondary text
  moment: colors.oro, // ONLY for moments that matter
  border: '#2A3B5C',
  bandAlt: '#EFEAE0', // sand band — alternating sections on avorio web pages
  inkOnLight: colors.bluNotte, // text on avorio = blu notte (one ink)
  inkMutedOnLight: '#5C6470', // secondary text on avorio (AA on #FAF7F0)
  success: '#3E7C59', // confirmations, check-in OK (deep green, calm)
  error: '#B3492D', // input error ring, destructive (terracotta)
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
 * Warm grotesque, two weights only (per brand identity, DESIGN.md §4).
 * serifFamily (Instrument Serif italic) is the dream register: ONLY for
 * dream quotes and ritual captions — never UI, never headings.
 */
export const typography = {
  fontFamily: 'Hanken Grotesk',
  serifFamily: 'Instrument Serif',
  weights: { regular: 400, semibold: 600 },
  /** Display wordmark (esoteric Λ glyph). Plain "Kaira" in body text and SEO. */
  wordmark: 'K Λ I R Λ',
} as const;

export type Colors = typeof colors;
export type Semantic = typeof semantic;
