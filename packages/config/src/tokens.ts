/**
 * Kaira design tokens — single source of truth for both Tailwind setups
 * (web Tailwind 4 @theme, mobile NativeWind config). Never use literal hex
 * in app code; import from here.
 *
 * Brand rule: stella (the cyan star) is reserved for moments that matter —
 * a new Momento, a dream helped, a star lit. Never decorative. The aurora
 * gradient (rose → magenta-violet → indigo → blue) is the logo/hero ring only.
 */

export const colors = {
  notte: '#000206', // near-black canvas (the night)
  luce: '#ECEEF6', // cool near-white — text on dark
  stella: '#2BD0D2', // glowing cyan — the moment that matters
} as const;

/** Aurora gradient — logo + hero ring ONLY. Not a UI accent. */
export const aurora = {
  rose: '#7D236E',
  magenta: '#672088',
  violet: '#212088',
  blu: '#223D86',
} as const;

export const semantic = {
  background: colors.notte,
  surface: '#100A1C', // notte lifted one step, violet-tinted — cards, sheets
  surfaceMuted: '#04030A', // notte recessed — tab bar, scrims
  foreground: colors.luce,
  foregroundMuted: '#9A9DB5', // luce dimmed — secondary text
  moment: colors.stella, // ONLY for moments that matter
  border: '#241B3A', // violet hairline
  bandAlt: '#0A0814', // alternate dark band — section striping
  inkOnLight: colors.notte, // text on rare light chips/print (light world retired)
  inkMutedOnLight: '#5C6478', // secondary on light chips/print
  success: '#36B37E', // confirmations, check-in OK (emerald — distinct from stella)
  error: '#E0476B', // input error ring, destructive (raspberry — rose family)
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
export type Aurora = typeof aurora;
export type Semantic = typeof semantic;
