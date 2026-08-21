import { describe, expect, it } from 'vitest';
import { cn } from './utils';

/**
 * `cn` looks like a one-liner with nothing to test, and that is the trap: it is two libraries
 * composed, and dropping either one leaves a function that still returns a plausible class string.
 * Without `twMerge` a caller's override loses to the component's own default and the wrong colour
 * ships; without `clsx` a conditional class becomes the literal text `false`. Neither throws.
 */
describe('cn', () => {
  it('lets a later class win over an earlier one in the same Tailwind group', () => {
    // This is the twMerge half, and it is why every component takes `className` last.
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-foreground', 'text-aura')).toBe('text-aura');
  });

  it('keeps classes from different groups side by side', () => {
    expect(cn('px-4', 'py-2')).toBe('px-4 py-2');
  });

  it('drops falsy conditionals instead of stringifying them', () => {
    // The clsx half. `false` and `undefined` must vanish, not land in the DOM as class names.
    expect(cn('rounded', false && 'hidden', undefined, null, '')).toBe('rounded');
  });

  it('accepts the object and array forms callers use', () => {
    expect(cn({ 'opacity-50': true, hidden: false })).toBe('opacity-50');
    expect(cn(['flex', 'items-center'], 'gap-2')).toBe('flex items-center gap-2');
  });

  it('returns an empty string when given nothing', () => {
    expect(cn()).toBe('');
  });
});
