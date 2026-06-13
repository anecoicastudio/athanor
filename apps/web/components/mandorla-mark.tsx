import { Mandorla } from '@/components/mandorla';

/**
 * Mandorla mark — la Mandorla (DESIGN.md §5), the animated hero centerpiece.
 * Renders the shared <Mandorla> so the hero is visually identical to the splash
 * intro mark (two circles + filled lens + glow + dots + the glowing Kairos star
 * on top), then settles into a calm loop (`loop`): rings breathe, star pulses
 * (the sanctioned "moment flash", slowed). Honors prefers-reduced-motion.
 *
 * On first load the entrance draws behind the splash overlay and finishes before
 * it lifts — so the splash cross-fades into this already-drawn, breathing mark
 * (one draw, clean handoff). Tokens only — no literal hex.
 * Decorative: aria-hidden; the hero <h1> tagline carries the accessible name.
 */
export function MandorlaMark({ className }: { className?: string }) {
  return (
    <div
      className={`mandorla-mark ${className ?? ''}`}
      style={{ width: 'clamp(300px, 60vw, 560px)', aspectRatio: '1' }}
      aria-hidden
    >
      <Mandorla idPrefix="hero" loop className="h-full w-full" />
    </div>
  );
}
