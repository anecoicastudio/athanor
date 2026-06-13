'use client';

/**
 * Mandorla mark — la Mandorla (DESIGN.md §5), animated hero centerpiece.
 * Vesica piscis: two r=55 circles whose centers are 55 apart, so each ring
 * passes through the other's center (two people meeting). The Kairos spark (✦)
 * sits at the top apex with a soft bloom.
 *
 * Entrance: the full circles draw first, THEN the star ignites at the apex.
 * Each circle is two semicircle arcs sharing the apex start point, so the dash
 * reveals from the apex down both sides — the rings finish as full, closed
 * circles (no half-drawn frame). Once they close, the Kairos spark fades in at
 * the apex with its bloom, then it settles into a calm loop: rings breathe,
 * spark pulses (the sanctioned "moment flash", slowed). Honors
 * prefers-reduced-motion → static final state.
 *
 * The rings are stroked with the aurora gradient (rose → magenta → violet →
 * blu); they carry NO glow. Only the stella star has a bloom — the one
 * sanctioned glow (§10's "moment flash").
 *
 * Color via `text-stella` + `currentColor` (spark/dots/bloom) and the aurora
 * `var(--color-aurora-*)` gradient (rings) — no literal hex.
 * Decorative: aria-hidden; the hero <h1> tagline carries the accessible name.
 */
export function MandorlaMark({ className, dots = false }: { className?: string; dots?: boolean }) {
  return (
    <div
      className={`mandorla-mark text-stella ${className ?? ''}`}
      style={{ width: 'clamp(220px, 42vw, 380px)', aspectRatio: '1' }}
      aria-hidden
    >
      <svg viewBox="0 0 200 200" fill="none" className="h-full w-full">
        <defs>
          {/* Aurora ring gradient — rose → magenta → violet → blu (logo/hero only) */}
          <linearGradient id="mandorla-ring-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-aurora-rose)" />
            <stop offset="35%" stopColor="var(--color-aurora-magenta)" />
            <stop offset="70%" stopColor="var(--color-aurora-violet)" />
            <stop offset="100%" stopColor="var(--color-aurora-blu)" />
          </linearGradient>
          <radialGradient id="mandorla-bloom-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--color-stella)" stopOpacity="0.9" />
            <stop offset="55%" stopColor="var(--color-stella)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-stella)" stopOpacity="0" />
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
            bottom (left at 45,157.63 · right at 155,157.63). Aurora gradient
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
