import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Auria card (DESIGN.md §8): surface bg, radius lg (20), hairline border.
 * `moment` adds the 1px aura border — reserved for moment cards only.
 */
export function Card({
  className,
  moment = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { moment?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-[20px] border bg-card p-5',
        moment ? 'border-aura' : 'border-border',
        className,
      )}
      {...props}
    />
  );
}
