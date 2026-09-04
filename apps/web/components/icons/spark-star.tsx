/**
 * The ✦ spark — the 4-point star (DESIGN.md §6). l'istante, a star lit.
 * `filled` = earned/lit (use sparingly — oro is a moment); outline = unearned/default.
 * Built from the Mandorla vocabulary: stroke 1.2, currentColor, never an icon pack.
 */
export function SparkStar({
  filled = false,
  size = 20,
  className,
}: {
  filled?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      <path
        d="M12 1 L14 10 L23 12 L14 14 L12 23 L10 14 L1 12 L10 10 Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  );
}
