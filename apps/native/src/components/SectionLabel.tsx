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
 * finding rather than caution: of the 108 call sites this component has, ~30 are not headings at
 * all. It is the form-field label over a single input (`Field.tsx:10` documents that role), the
 * category badge beside a post (`feed/FeedPost.tsx:24`), the «oppure con email» divider between
 * two rules (`(auth)/welcome.tsx`), and the eyebrow above a display title that is the real
 * heading. Defaulting to `header` would have announced every one of those as a section.
 *
 * So the mechanism lands here and the roster is filled in where the answer is not a judgement
 * call — the grouped-list section headers, where the label IS the group. The largest remaining
 * class is the ~15 eyebrow-above-a-title sites, where the fix is arguably to make the TITLE the
 * header and leave the eyebrow alone; that is a DESIGN.md ruling, not a code change, and it is
 * called out in the PR rather than decided here.
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
