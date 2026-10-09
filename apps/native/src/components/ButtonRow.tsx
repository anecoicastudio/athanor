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
 * `max-w-full` is for react-native-web: Yoga already caps a `basis-auto` cell at the row's width,
 * the browser does not, and an over-wide pill would otherwise run off the page there.
 *
 * `null` / `false` children are skipped, so a conditional pill leaves no empty cell and no gap.
 *
 * `items-baseline`: the cells of a row are not one height. A pill is 50pt and a `ghost` link
 * 44pt, and a cell may stack two lines (`ConnectButton` while a request is pending). So the
 * row lines up TEXT: every first-line label sits on one baseline, whatever its cell holds.
 * `Button` keeps its label in the layout while it is busy for the same reason: the baseline is
 * the label's. `source-audit.test.ts` section 43 holds both, and says what the two other
 * alignments measured.
 *
 * How a cell finds its baseline (`calculateBaseline` in Yoga's `algorithm/Baseline.cpp`, as
 * shipped in react-native 0.86.3; read 2026-10-04): a text node reports its own; any other
 * node takes its first child in the flow, and skips an absolutely positioned one; a node with
 * no such child reports its own height. So a cell may hold a `Button`, a stack or a nested row
 * and still line up by its first label, and the icon gutter and the spinner never count.
 */
export function ButtonRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <View className={cn('flex-row flex-wrap items-baseline gap-3', className)}>
      {Children.toArray(children).map((child, i) => (
        <View key={i} className="max-w-full shrink-0 grow basis-auto">
          {child}
        </View>
      ))}
    </View>
  );
}
