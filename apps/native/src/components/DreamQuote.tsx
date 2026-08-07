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
  /** Row-scale preview (SuggestionRow): 13px/faint instead of the display quote. */
  compact?: boolean;
  numberOfLines?: number;
  className?: string;
}) {
  const scale = compact ? 'text-[13px] text-faint' : 'text-xl leading-relaxed text-foreground';
  return (
    <Text numberOfLines={numberOfLines} className={cn('font-dream', scale, className)}>
      «{text}»
    </Text>
  );
}
