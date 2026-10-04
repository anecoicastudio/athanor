import type { ReactNode } from 'react';
import { cn, Text } from '@/tw';

/**
 * The label that names a section, a field or a group (DESIGN §4 `label`: 13/500, plain grey,
 * sentence case). The one home for that style: add labels here, not inline.
 *
 * Until 2026-10-04 this was the letterspaced uppercase eyebrow, in four tones. The mobile look
 * has no uppercase and no letterspacing outside the wordmark (#921), and a label is grey, so
 * the catalog's words are drawn as they are typed. One tone is left beside the plain one:
 * `celebration`, the cyan line above the title of the five celebration screens, which is one of
 * the five cyan marks of DESIGN §2.3. `source-audit.test.ts` holds both the class and the files.
 *
 * `className` is for position only (`mt-6`, `mb-2`, `px-5 pb-2`). `type-label` owns the size
 * and the line height, so a size utility beside it does nothing (DESIGN §4).
 *
 * `heading` puts the label in the VoiceOver rotor (#635). OPT-IN, not the default, and that is a
 * finding rather than caution: many of this component's call sites are not headings at all. It is
 * the form-field label over a single input (`Field`'s docblock documents that role), the category
 * badge beside a post (`feed/FeedPost.tsx`), the «oppure con email» divider between two rules
 * (`(auth)/welcome.tsx`), and the label above a display title that is the real heading.
 * Defaulting to `header` would have announced every one of those as a section.
 *
 * Which half a site falls in is now settled rather than a judgement call (DESIGN.md §10, ruled
 * 2026-09-07, #651): where a label sits above a display title, the TITLE carries
 * `accessibilityRole="header"` and the label carries nothing — the rotor lands on «Controlla la
 * tua email», not on «Quasi fatto». Pass `heading` only where the label IS the section's text: a
 * grouped-list section header, a card label. One heading per block, never two.
 */
const TONE = {
  plain: 'text-muted-foreground',
  celebration: 'text-aura',
} as const;

export function SectionLabel({
  children,
  tone = 'plain',
  className,
  numberOfLines,
  accessibilityLabel,
  heading = false,
}: {
  children: ReactNode;
  tone?: keyof typeof TONE;
  className?: string;
  numberOfLines?: number;
  /** The full text, where `numberOfLines` may ellipsize it (#754). */
  accessibilityLabel?: string;
  heading?: boolean;
}) {
  return (
    <Text
      accessibilityRole={heading ? 'header' : undefined}
      accessibilityLabel={accessibilityLabel}
      className={cn('type-label', TONE[tone], className)}
      numberOfLines={numberOfLines}
    >
      {children}
    </Text>
  );
}
