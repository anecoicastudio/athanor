'use client';

/**
 * Mandorla mark — la Mandorla (DESIGN.md §5), animated hero centerpiece.
 * Vesica piscis: two r=55 circles whose centers are 55 apart, so each ring
 * passes through the other's center (two people meeting). The Kairos star (✦)
 * sits at the top apex with a soft bloom.
 *
 * Entrance: the circles (arcs) draw first, THEN the star ignites at the apex.
 * Each circle is two semicircle arcs sharing the apex start point, so the dash
 * reveals from the apex down both sides — the rings finish as full, closed
 * circles (no half-drawn frame). Once they close, the star fades in at the apex
 * with its bloom, then it settles into a calm loop: rings breathe, star pulses
 * (the sanctioned "moment flash", slowed). Honors prefers-reduced-motion.
 *
 * Color: star + bloom via `text-aura` + `currentColor`; the rings via the
 * mandala `var(--color-gradient-*)` gradient — no literal hex.
 * Decorative: aria-hidden; the hero <h1> tagline carries the accessible name.
 */
export function MandorlaMark({ className }: { className?: string }) {
  return (
    <div
      className={`mandorla-mark text-aura ${className ?? ''}`}
      style={{ width: 'clamp(220px, 42vw, 380px)', aspectRatio: '1' }}
      aria-hidden
    >
      <svg viewBox="0 0 200 200" fill="none" className="h-full w-full">
        <defs>
          {/* Mandala gradient — magenta → violet → indigo (logo/hero only) */}
          <linearGradient id="mandorla-ring-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-gradient-1)" />
            <stop offset="50%" stopColor="var(--color-gradient-2)" />
            <stop offset="100%" stopColor="var(--color-gradient-3)" />
          </linearGradient>
          <radialGradient id="mandorla-bloom-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--color-aura)" stopOpacity="0.9" />
            <stop offset="55%" stopColor="var(--color-aura)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-aura)" stopOpacity="0" />
          </radialGradient>
          <filter id="mandorla-bloom-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>

        {/* Soft apex bloom — the only glow on the canvas */}
        <circle
          className="mandorla-bloom"
          cx="100"
          cy="60"
          r="26"
          fill="url(#mandorla-bloom-grad)"
          filter="url(#mandorla-bloom-blur)"
        />

        {/* The two rings (vesica piscis), each as two semicircle arcs that share
            the apex (100,62.37) — they draw from the apex and close at the
            bottom (left at 45,157.63 · right at 155,157.63). Mandala gradient
            stroke, no glow. */}
        <g
          className="mandorla-rings"
          stroke="url(#mandorla-ring-gradient)"
          strokeWidth="2"
          fill="none"
        >
          <path
            className="mandorla-arc"
            d="M100 62.37 A55 55 0 0 1 45 157.63"
            vectorEffect="non-scaling-stroke"
          />
          <path
            className="mandorla-arc"
            d="M100 62.37 A55 55 0 0 0 45 157.63"
            vectorEffect="non-scaling-stroke"
          />
          <path
            className="mandorla-arc"
            d="M100 62.37 A55 55 0 0 1 155 157.63"
            vectorEffect="non-scaling-stroke"
          />
          <path
            className="mandorla-arc"
            d="M100 62.37 A55 55 0 0 0 155 157.63"
            vectorEffect="non-scaling-stroke"
          />
        </g>

        {/* Kairos star at the top apex — fades in, then pulses (moment flash) */}
        <path
          className="mandorla-spark"
          d="M100 44 L103 57 L116 60 L103 63 L100 76 L97 63 L84 60 L97 57 Z"
          fill="currentColor"
        />
      </svg>
    </div>
  );
}
