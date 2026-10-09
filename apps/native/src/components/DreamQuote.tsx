import { cn, Text } from '@/tw';

/**
 * The dream register (DESIGN.md §4): dream quotes render in Hanken italic —
 * the brand's "dream voice", never a UI font, never a heading. Lives in ONE
 * component so a single edit re-themes every quote.
 *
 * Owns the guillemets: call sites pass raw text. The `font-dream` TextInputs
 * (dream editor, onboarding, candidacy) are the *input* register, not this one.
 */
export function DreamQuote({
  text,
  compact = false,
  numberOfLines,
  className,
}: {
  text: string;
  /**
   * Row-scale preview (SuggestionRow): the dream italic at the `small` size (15) instead of
   * the display quote. Foreground, not grey — inside a row the dream is the payload and has to
   * outrank the metadata Tag beside it, which is a bordered pill and wins any colour tie.
   */
  compact?: boolean;
  numberOfLines?: number;
  className?: string;
}) {
  // `type-quote` carries the italic face itself; the compact one takes it from `font-dream`.
  const scale = compact ? 'font-dream text-[15px]' : 'type-quote';
  return (
    <Text numberOfLines={numberOfLines} className={cn(scale, 'text-foreground', className)}>
      «{text}»
    </Text>
  );
}
