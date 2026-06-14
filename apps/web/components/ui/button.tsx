import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Athanor button (DESIGN.md §8). Pill, letterspaced, two-weight type.
 * - primary: foreground on background — the default action. Aura is NOT primary.
 * - moment: aura — ONLY moment actions (accept Momento, help dream, contribute). Add a ✦ child.
 * - ghost: muted, underline on hover.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-full text-[13px] font-semibold tracking-[0.14em] transition-opacity duration-200 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  {
    variants: {
      variant: {
        primary: 'h-12 px-6 bg-foreground text-background hover:opacity-90',
        moment: 'h-12 px-6 bg-aura text-background hover:opacity-90',
        ghost: 'text-muted-foreground underline-offset-4 hover:underline',
      },
    },
    defaultVariants: { variant: 'primary' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant }), className)} {...props} />;
}

export { buttonVariants };
