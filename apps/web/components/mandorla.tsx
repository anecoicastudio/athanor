import { cn } from '@/lib/utils';

/**
 * Mandorla — the single Auria mark (DESIGN.md §5), shared by the splash intro
 * and the hero so the two are visually identical. Vesica piscis: two circles
 * whose overlap forms the vertical lens almond (two people meeting); the Kairos
 * star (✦) sits at the apex on top.
 *
 * Entrance (pure CSS, declarative — no JS timers, no hydration cost): the
 * circles + lens draw in from empty (stroke-dash), the lens glow fades in, then
 * the star pops at the apex. The three dots drift upward on a calm loop. With
 * `loop` the rings also breathe and the star pulses (the sanctioned "moment
 * flash", slowed). Honors prefers-reduced-motion (globals.css → static final
 * state).
 *
 * Tokens only: the rings/lens use the mandala `var(--color-gradient-*)` gradient
 * (logo/hero only); the star, dots and lens glow use `var(--color-aura)`. No
 * literal hex.
 *
 * `idPrefix` namespaces the gradient ids — REQUIRED because the splash and the
 * hero both mount on the same page and un-namespaced ids would collide.
 * Decorative: aria-hidden is set by the caller's wrapper where needed.
 */
export function Mandorla({
  idPrefix,
  loop = false,
  className,
}: {
  idPrefix: string;
  /** Hero: breathe the rings + pulse the star after the draw. Splash: false. */
  loop?: boolean;
  className?: string;
}) {
  const mandala = `${idPrefix}-mandala`;
  const glow = `${idPrefix}-glow`;
  const starGlow = `${idPrefix}-star-glow`;
  const lens = 'M50 24 A30 30 0 0 1 50 76 A30 30 0 0 1 50 24 Z';

  return (
    <svg viewBox="0 0 100 100" className={className} fill="none">
      <defs>
        <linearGradient id={mandala} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-gradient-1)" />
          <stop offset="50%" stopColor="var(--color-gradient-2)" />
          <stop offset="100%" stopColor="var(--color-gradient-3)" />
        </linearGradient>
        <radialGradient id={glow} cx="50%" cy="42%" r="60%">
          <stop offset="0%" stopColor="var(--color-aura)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--color-aura)" stopOpacity="0" />
        </radialGradient>
        {/* star halo — blooms each time a rising dot reaches the apex */}
        <radialGradient id={starGlow} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-aura)" stopOpacity="0.7" />
          <stop offset="100%" stopColor="var(--color-aura)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* rings (circles + lens) — draw in; breathe as a unit when looping */}
      <g className={loop ? 'mandorla-rings--loop' : undefined}>
        {/* two overlapping circles — faint mandala stroke */}
        <circle
          className="mandorla-draw-stroke"
          cx="35"
          cy="50"
          r="30"
          stroke={`url(#${mandala})`}
          strokeOpacity="0.4"
          strokeWidth="1.1"
        />
        <circle
          className="mandorla-draw-stroke"
          cx="65"
          cy="50"
          r="30"
          stroke={`url(#${mandala})`}
          strokeOpacity="0.4"
          strokeWidth="1.1"
        />
        {/* the vertical lens-almond — mandala fill + cyan stroke, draws after */}
        <path
          className={cn('mandorla-draw-stroke', 'mandorla-lens')}
          d={lens}
          fill={`url(#${mandala})`}
          fillOpacity="0.3"
          stroke="var(--color-aura)"
          strokeWidth="1.2"
        />
      </g>

      {/* soft cyan glow inside the lens */}
      <path className="mandorla-glow" d={lens} fill={`url(#${glow})`} />

      {/* the dots — a synchronized STOP-AND-GO stream (all authored at cy 66; the
          staircase translate in globals.css steps them up the column in unison). Three
          dots always sit in the lens BODY (slots cy 66/54/42); the 4th rises into the
          star CENTER (cy 24) and fades out there as the star glows, then a new dot rises
          from the bottom. The whole stream pauses each time a dot reaches the star. FOUR
          elements offset by ¼ cycle → at every frame three are solid in the lens and the
          4th is fading into the star (or recycling). The <g> fades the stream in after
          the rings draw. */}
      <g className="mandorla-dots">
        <circle
          className="mandorla-dot mandorla-dot--1"
          cx="50"
          cy="66"
          r="1.9"
          fill="var(--color-aura)"
        />
        <circle
          className="mandorla-dot mandorla-dot--2"
          cx="50"
          cy="66"
          r="1.9"
          fill="var(--color-aura)"
        />
        <circle
          className="mandorla-dot mandorla-dot--3"
          cx="50"
          cy="66"
          r="1.9"
          fill="var(--color-aura)"
        />
        <circle
          className="mandorla-dot mandorla-dot--4"
          cx="50"
          cy="66"
          r="1.9"
          fill="var(--color-aura)"
        />
      </g>

      {/* Kairos star at the lens apex (LAST child → on top): the elongated cyan
          sparkle. Pops in, then pulses when looping. Outer <g> positions
          (translate); inner <g> carries the animated transform (scale) — kept
          separate so the pop/pulse scale doesn't override the translate. */}
      <g transform="translate(50,24)">
        {/* halo behind the star — pulses in rhythm with the rising dots */}
        <circle className="mandorla-halo" cx="0" cy="0" r="15" fill={`url(#${starGlow})`} />
        <g className={loop ? 'mandorla-spark--loop' : 'mandorla-spark'}>
          <path d="M0 -14 L2 -2 L14 0 L2 2 L0 14 L-2 2 L-14 0 L-2 -2 Z" fill="var(--color-aura)" />
        </g>
      </g>
    </svg>
  );
}
