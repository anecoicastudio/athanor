'use client';

/**
 * Mandorla mark — la Mandorla (DESIGN.md §5), animated hero centerpiece.
 * Vesica piscis: two r=55 circles whose centers are 55 apart, so each ring
 * passes through the other's center (two people meeting). The Kairos spark (✦)
 * sits at the top apex with a soft bloom — the one glow allowed on the canvas
 * (user-approved bend of §5's "never add glow").
 *
 * Entrance draws the rings in and fades the spark in (globals.css), then it
 * settles into a calm loop: rings breathe, spark pulses (the sanctioned
 * "moment flash", slowed). Honors prefers-reduced-motion → static final state.
 *
 * Color via `text-oro` + `currentColor` and `var(--color-oro)` — no literal hex.
 * Decorative: aria-hidden; the hero <h1> tagline carries the accessible name.
 */
export function MandorlaMark({ className, dots = false }: { className?: string; dots?: boolean }) {
  return (
    <div
      className={`mandorla-mark text-oro ${className ?? ''}`}
      style={{ width: 'clamp(220px, 42vw, 380px)', aspectRatio: '1' }}
      aria-hidden
    >
      <svg viewBox="0 0 200 200" fill="none" className="h-full w-full">
        <defs>
          <radialGradient id="mandorla-bloom-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--color-oro)" stopOpacity="0.9" />
            <stop offset="55%" stopColor="var(--color-oro)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-oro)" stopOpacity="0" />
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

        {/* The two full rings (vesica piscis) — drawn in on load, then breathe */}
        <g className="mandorla-rings" stroke="currentColor" strokeWidth="2" fill="none">
          <circle
            className="mandorla-ring"
            cx="72.5"
            cy="110"
            r="55"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            className="mandorla-ring"
            cx="127.5"
            cy="110"
            r="55"
            vectorEffect="non-scaling-stroke"
          />

          {dots && (
            <>
              {/* Three ascending dots: arrival · dream (ringed) · passage */}
              <circle cx="100" cy="92" r="2.6" fill="currentColor" stroke="none" />
              <circle cx="100" cy="110" r="3.4" fill="currentColor" stroke="none" />
              <circle cx="100" cy="110" r="9" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              <circle cx="100" cy="128" r="2.6" fill="currentColor" stroke="none" />
            </>
          )}
        </g>

        {/* Kairos spark at the top apex — fades in, then pulses (moment flash) */}
        <path
          className="mandorla-spark"
          d="M100 48 L103.2 56.8 L112 60 L103.2 63.2 L100 72 L96.8 63.2 L88 60 L96.8 56.8 Z"
          fill="currentColor"
        />
      </svg>
    </div>
  );
}
