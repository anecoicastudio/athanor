import { Mandorla } from '@/components/mandorla';

/**
 * Mandorla mark — la Mandorla (DESIGN.md §5), the animated hero centerpiece.
 * Renders the shared <Mandorla> (two circles + filled lens + glow + dots + the glowing ✦ spark
 * on top), then settles into a calm loop (`loop`): rings breathe, star pulses
 * (the sanctioned "moment flash", slowed). Honors prefers-reduced-motion.
 *
 * Tokens only — no literal hex. Since 2026-10-03 the landing no longer mounts it; the 404
 * page does.
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
