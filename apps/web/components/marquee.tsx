import { t } from '@auria/i18n';

/**
 * Brand ribbon — a slow, calm marquee of oversized light type, between bands
 * (marinkurir-inspired editorial seam). Pure CSS (keyframe + .marquee-track in
 * globals.css); no JS, stays in the static export. Decorative → aria-hidden.
 * Frozen under prefers-reduced-motion. Low-contrast foreground (not aura cyan).
 */
const L = 'it' as const;

export function Marquee() {
  // Repeat the phrase so each half fills wide viewports; two identical halves
  // make the -50% translate loop seamless.
  const half = t('landing.marquee', L).repeat(6);
  return (
    <div
      aria-hidden
      className="select-none overflow-hidden border-y border-border/40 bg-band-alt py-5"
    >
      <div className="marquee-track flex w-max">
        <span className="whitespace-pre text-[clamp(2.25rem,8vw,5.5rem)] font-light tracking-tight text-foreground/12">
          {half}
        </span>
        <span className="whitespace-pre text-[clamp(2.25rem,8vw,5.5rem)] font-light tracking-tight text-foreground/12">
          {half}
        </span>
      </div>
    </div>
  );
}
