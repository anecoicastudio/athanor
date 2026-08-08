import type { ComponentType } from 'react';

/**
 * Sacred-geometry glyphs (DESIGN.md §6): built from the Mandorla vocabulary —
 * circles, triangles, points. Stroke 1.2, `currentColor`, never filled except
 * the center point. No icon pack, no aura cyan, no mandala gradient (those are
 * logo/hero only). One per pillar + a Ripples motif (Il Nome) and a Plus marker.
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

// Concentric ripples — Kairos, the moment expanding. (Athanor Live, Il Nome)
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

// Center point — the «+» seam marker (DESIGN.md center-point glyph).
export function Plus({ size = 14, className }: GlyphProps) {
  return svg(
    size,
    className,
    <>
      <path d="M12 5 V19 M5 12 H19" />
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
