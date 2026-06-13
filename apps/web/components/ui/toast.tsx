import { cn } from '@/lib/utils';

/**
 * Presentational toast (DESIGN.md §8): bottom, surface bg, leading ✓ for success.
 * Calm 200ms opacity fade. The caller owns visibility + auto-dismiss timing.
 */
export function Toast({ message, show }: { message: string; show: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit items-center gap-2 rounded-full border border-border bg-card px-5 py-3 text-sm text-foreground shadow-lg transition-opacity duration-200',
        show ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <span aria-hidden className="text-success">
        ✓
      </span>
      {message}
    </div>
  );
}
