import type { ComponentType } from 'react';
import type { ZodiacSign } from '@athanor/schemas';

/**
 * Sacred-geometry glyphs (DESIGN.md §6): built from the Mandorla vocabulary —
 * circles, triangles, points. Stroke 1.2, `currentColor`, never filled except
 * the center point. No icon pack, no aura cyan, no mandala gradient (those are
 * logo/hero only). One per pillar + a Ripples motif (Il Nome).
 */
type GlyphProps = { size?: number; className?: string };

function svg(size: number, className: string | undefined, children: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinejoin="round"
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

// Concentric ripples — the moment expanding. (Athanor Live, Il Nome)
export function Ripples({ size = 28, className }: GlyphProps) {
  return svg(
    size,
    className,
    <>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>,
  );
}

// Vesica / mandorla — the encounter, the gate. (Momenti)
export function Vesica({ size = 28, className }: GlyphProps) {
  return svg(
    size,
    className,
    <>
      <circle cx="9" cy="12" r="6.5" />
      <circle cx="15" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>,
  );
}

// Constellation — single stars becoming a visible pattern. (Costellazioni)
export function Constellation({ size = 28, className }: GlyphProps) {
  return svg(
    size,
    className,
    <>
      <path d="M5 7 L17 5 L19 16 L9 18 Z" strokeOpacity="0.5" />
      <circle cx="5" cy="7" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="17" cy="5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="19" cy="16" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none" />
    </>,
  );
}

// Particle field — the community, the night sky. (Community)
export function Particles({ size = 28, className }: GlyphProps) {
  return svg(
    size,
    className,
    <>
      <path d="M6 9 L8 5 L10 9 Z" />
      <path d="M15 7 L17 3 L19 7 Z" strokeOpacity="0.6" />
      <path d="M13 18 L15 14 L17 18 Z" strokeOpacity="0.6" />
      <circle cx="7" cy="17" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="20" cy="15" r="1" fill="currentColor" stroke="none" />
    </>,
  );
}

// Diamond / facet — what you offer, made visible. (Marketplace)
export function Diamond({ size = 28, className }: GlyphProps) {
  return svg(
    size,
    className,
    <>
      <path d="M12 3 L20 12 L12 21 L4 12 Z" />
      <path d="M6.5 9.5 H17.5" strokeOpacity="0.5" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>,
  );
}

// Ring — belonging, the inner circle. (Athanor Circle)
export function Ring({ size = 28, className }: GlyphProps) {
  return svg(
    size,
    className,
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
    </>,
  );
}

/** Pillar key → glyph, consumed by the landing's full-width pillar rows. */
export const PILLAR_GLYPHS: Record<string, ComponentType<GlyphProps>> = {
  community: Particles,
  live: Ripples,
  momenti: Vesica,
  costellazioni: Constellation,
  marketplace: Diamond,
  circle: Ring,
};

/**
 * Zodiac set (DESIGN.md §6 addendum, #694) — the same twelve drawings as
 * apps/native/src/components/glyphs.tsx at this file's 1.2 stroke. Cosmetic register:
 * `text-muted-foreground`, never `text-aura`, never a glow. Rendered only beside the name on
 * the public @handle page; `aria-hidden` here, the accessible text is the sibling `sr-only`.
 */
export function Ariete({ size = 18, className }: GlyphProps) {
  return svg(
    size,
    className,
    <>
      <path d="M12 21V8" />
      <path d="M12 8c0-5-6-5-6 0" />
      <path d="M12 8c0-5 6-5 6 0" />
    </>,
  );
}
export function Toro({ size = 18, className }: GlyphProps) {
  return svg(
    size,
    className,
    <>
      <circle cx="12" cy="14" r="6" />
      <path d="M5 4c0 4 3 6 7 6s7-2 7-6" />
    </>,
  );
}
export function Gemelli({ size = 18, className }: GlyphProps) {
  return svg(
    size,
    className,
    <>
      <path d="M8 5v14M16 5v14" />
      <path d="M5 4c3 2 11 2 14 0" />
      <path d="M5 20c3-2 11-2 14 0" />
    </>,
  );
}
export function Cancro({ size = 18, className }: GlyphProps) {
  return svg(
    size,
    className,
    <>
      <circle cx="8.5" cy="9" r="2.5" />
      <circle cx="15.5" cy="15" r="2.5" />
      <path d="M6 9c0-5 8-6 12-2M18 15c0 5-8 6-12 2" />
    </>,
  );
}
export function Leone({ size = 18, className }: GlyphProps) {
  return svg(
    size,
    className,
    <>
      <circle cx="7.5" cy="15.5" r="3" />
      <path d="M10.5 15.5C10.5 9 12 4 15 4c3 0 4 3 4 5 0 3-3 6-3 9 0 2 2 3 4 2" />
    </>,
  );
}
export function Vergine({ size = 18, className }: GlyphProps) {
  return svg(
    size,
    className,
    <>
      <path d="M4 18V8c0-2 4-2 4 0v10M8 8c0-2 4-2 4 0v10" />
      <path d="M12 12c4 0 7 3 6 6c-1 2-4 2-6 0" />
    </>,
  );
}
export function Bilancia({ size = 18, className }: GlyphProps) {
  return svg(
    size,
    className,
    <>
      <path d="M4 15h4a4 4 0 0 1 8 0h4" />
      <path d="M4 19h16" />
    </>,
  );
}
export function Scorpione({ size = 18, className }: GlyphProps) {
  return svg(
    size,
    className,
    <>
      <path d="M4 18V8c0-2 4-2 4 0v10M8 8c0-2 4-2 4 0v10" />
      <path d="M12 8v8c0 2 2 3 4 2" />
      <path d="M15 15l2 3-3 1" />
    </>,
  );
}
export function Sagittario({ size = 18, className }: GlyphProps) {
  return svg(
    size,
    className,
    <>
      <path d="M5 19L19 5" />
      <path d="M12 5h7v7" />
      <path d="M8 12l4 4" />
    </>,
  );
}
export function Capricorno({ size = 18, className }: GlyphProps) {
  return svg(
    size,
    className,
    <>
      <path d="M4 7c1-2 3-2 4 0v9M8 7c1-2 3-2 4 0v7" />
      <circle cx="16" cy="15" r="3.5" />
      <path d="M12.5 14c0-4 3-5 6-3" />
    </>,
  );
}
export function Acquario({ size = 18, className }: GlyphProps) {
  return svg(
    size,
    className,
    <>
      <path d="M3 9l3-3 3 3 3-3 3 3 3-3 3 3" />
      <path d="M3 16l3-3 3 3 3-3 3 3 3-3 3 3" />
    </>,
  );
}
export function Pesci({ size = 18, className }: GlyphProps) {
  return svg(
    size,
    className,
    <>
      <path d="M7 4c-4 4-4 12 0 16" />
      <path d="M17 4c4 4 4 12 0 16" />
      <path d="M4 12h16" />
    </>,
  );
}

/** Every storable sign has a drawing — a missing key is a type error, not a blank. */
export const ZODIAC_GLYPHS: Record<ZodiacSign, ComponentType<GlyphProps>> = {
  ariete: Ariete,
  toro: Toro,
  gemelli: Gemelli,
  cancro: Cancro,
  leone: Leone,
  vergine: Vergine,
  bilancia: Bilancia,
  scorpione: Scorpione,
  sagittario: Sagittario,
  capricorno: Capricorno,
  acquario: Acquario,
  pesci: Pesci,
};

export function ZodiacGlyph({ sign, size = 18, className }: GlyphProps & { sign: ZodiacSign }) {
  const Glyph = ZODIAC_GLYPHS[sign];
  return <Glyph size={size} className={className} />;
}
