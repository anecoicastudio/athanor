import type { TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** Auria input field (DESIGN.md §8): surface bg, hairline border, foreground focus ring. */
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-3xl border border-border bg-card px-5 py-4 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground',
        className,
      )}
      {...props}
    />
  );
}
