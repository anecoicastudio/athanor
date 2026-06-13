import type { ReactNode } from 'react';
import { Meridian } from '@/components/icons';

/** Thin-line motif + a line + optional ghost action (DESIGN.md §8). Never a sad face. */
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <Meridian size={32} className="text-border" />
      <p className="text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}
