import type { ReactNode } from 'react';

/**
 * Editorial chapter marker (marinkurir-inspired): an index number + a hairline
 * rule + the section name in micro uppercase — echoing the AURIA concept doc's
 * own dividers («01 · IL NOME»). Horizontal by default; on ≥lg it pins to the
 * section's left edge and reads vertically. Decorative chrome → aria-hidden.
 *
 * Parent <Section> is `relative` with `lg:pl-20` so the vertical label clears
 * the content column.
 */
export function SectionLabel({ index, children }: { index: string; children: ReactNode }) {
  return (
    <div
      aria-hidden
      className="mb-10 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground lg:absolute lg:left-0 lg:top-0 lg:mb-0 lg:[writing-mode:vertical-rl] lg:rotate-180 lg:gap-4"
    >
      <span className="tabular-nums text-foreground/70">{index}</span>
      <span className="h-px w-8 bg-border lg:h-10 lg:w-px" />
      <span>{children}</span>
    </div>
  );
}
