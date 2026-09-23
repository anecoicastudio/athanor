import { Children, type ReactNode } from 'react';
import { View, cn } from '@/tw';

/**
 * Side-by-side Buttons (#833, Marco's ruling 2026-09-23): the ROW wraps, the label never does.
 *
 * Each child sits in a cell that starts at its content's width (`basis-auto`), never shrinks
 * under it (`shrink-0`) and takes a share of any room left over (`grow`). So a pill is always as
 * wide as its label on one line, and a pill that does not fit beside the others drops to the
 * next line instead of breaking its label mid-word — which is what a `flex-1` cell did to
 * «Accetta» / «Rifiuta» on an iPhone SE. DESIGN §10 forbids capping the text instead, so this is
 * the only honest way to keep a label on one line at every text size.
 *
 * The one wrap left inside a pill: a lone label wider than the screen at 2× (§10), which has no
 * row to drop to. `source-audit` §43 fails a Button handed a `flex-1` cell, pointing here.
 *
 * `null` / `false` children are skipped, so a conditional pill leaves no empty cell and no gap.
 */
export function ButtonRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <View className={cn('flex-row flex-wrap gap-3', className)}>
      {Children.toArray(children).map((child, i) => (
        <View key={i} className="shrink-0 grow basis-auto">
          {child}
        </View>
      ))}
    </View>
  );
}
