import { cn } from '@/lib/utils';

/**
 * Circle avatar with an initial fallback (DESIGN.md §8). No image upload in M1.
 * The oro evolutionary-story ring is deferred to M3 (story feature).
 */
export function Avatar({
  handle,
  size = 96,
  className,
}: {
  handle: string | null;
  size?: number;
  className?: string;
}) {
  const initial = (handle ?? '?').charAt(0).toUpperCase();
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-surface-muted text-foreground',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <span className="font-semibold" style={{ fontSize: Math.round(size * 0.4) }} aria-hidden>
        {initial}
      </span>
    </div>
  );
}
