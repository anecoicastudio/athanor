import type { ReactNode } from 'react';
import { cn, Text } from '@/tw';

/**
 * Small-caps micro label heading a section or a screen (DESIGN §4 micro: 11/600).
 *
 * The one home for `text-[11px] font-semibold uppercase tracking-[0.18em]`, which had been
 * hand-copied to 53 sites while this component sat in 21 others. Add eyebrows here, not inline.
 *
 * `tone` preserves the colours those sites already used — it is NOT four interchangeable
 * options. `faint` is a section label inside a screen; `aura` is a screen/hero eyebrow sitting
 * above an H1 (two cyan eyebrows on one scroll costs the first its rank — see momenti.tsx).
 * `muted` and `foreground` exist because 10 sites use them and this consolidation deliberately
 * changed no pixels; whether they are meaningful or drift is an open question, not a licence.
 *
 * `className` is for position only (`mt-6`, `mb-2`, `px-5 pb-2`). Don't override the type scale
 * through it — react-native-css resolves same-specificity conflicts by source order, which is
 * not something to rely on for a size.
 *
 * `heading` puts the label in the VoiceOver rotor (#635). OPT-IN, not the default, and that is a
 * finding rather than caution: many of this component's call sites are not headings at all. It is
 * the form-field label over a single input (`Field.tsx:10` documents that role), the category
 * badge beside a post (`feed/FeedPost.tsx:24`), the «oppure con email» divider between two rules
 * (`(auth)/welcome.tsx`), and the eyebrow above a display title that is the real heading.
 * Defaulting to `header` would have announced every one of those as a section.
 *
 * Which half a site falls in is now settled rather than a judgement call (DESIGN.md §10, ruled
 * 2026-09-07, #651): where an eyebrow sits above a display title, the TITLE carries
 * `accessibilityRole="header"` and the eyebrow carries nothing — the rotor lands on «Controlla la
 * tua email», not on «QUASI FATTO». Pass `heading` only where the label IS the section's text: a
 * grouped-list section header, a card label. One heading per block, never two.
 */
const TONE = {
  faint: 'text-faint',
  aura: 'text-aura',
  muted: 'text-muted-foreground',
  foreground: 'text-foreground',
} as const;

export function SectionLabel({
  children,
  tone = 'faint',
  className,
  numberOfLines,
  heading = false,
}: {
  children: ReactNode;
  tone?: keyof typeof TONE;
  className?: string;
  numberOfLines?: number;
  heading?: boolean;
}) {
  return (
    <Text
      accessibilityRole={heading ? 'header' : undefined}
      className={cn('text-[11px] font-semibold uppercase tracking-[0.18em]', TONE[tone], className)}
      numberOfLines={numberOfLines}
    >
      {children}
    </Text>
  );
}
