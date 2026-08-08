import type { ReactNode } from 'react';
import { cn, Text } from '@/tw';

/**
 * Small-caps micro label heading a section or a screen (DESIGN §4 micro: 11/600).
 *
 * The one home for `text-[11px] font-semibold uppercase tracking-[0.16em]`, which had been
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
}: {
  children: ReactNode;
  tone?: keyof typeof TONE;
  className?: string;
}) {
  return (
    <Text
      className={cn('text-[11px] font-semibold uppercase tracking-[0.16em]', TONE[tone], className)}
    >
      {children}
    </Text>
  );
}
