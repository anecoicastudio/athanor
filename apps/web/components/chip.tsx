import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Interactive selection chip (the onboarding tag chip, promoted).
 * selected = luce/notte (DESIGN.md §8 toggle); idle = hairline-bordered.
 */
export function Chip({
  selected = false,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'rounded-full px-5 py-2.5 font-semibold transition-colors duration-200',
        selected ? 'bg-luce text-notte' : 'border border-border bg-card text-foreground',
        className,
      )}
      {...props}
    />
  );
}

/** Static tag for read mode — a fact, not a control. Quiet hairline pill. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-card px-4 py-1.5 text-[13px] text-foreground">
      {children}
    </span>
  );
}
