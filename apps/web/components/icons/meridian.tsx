/**
 * Meridian sphere (DESIGN.md §6) — circle + inner meridians = the self that evolves.
 * The Profilo glyph; also the empty-state motif. Stroke 1.2, currentColor.
 */
export function Meridian({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={1.2} />
      <ellipse cx="12" cy="12" rx="4.5" ry="10" stroke="currentColor" strokeWidth={1.2} />
      <line x1="2.5" y1="12" x2="21.5" y2="12" stroke="currentColor" strokeWidth={1.2} />
    </svg>
  );
}
