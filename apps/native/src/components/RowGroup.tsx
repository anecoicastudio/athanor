import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { View } from '@/tw';
import { SectionLabel } from '@/components/SectionLabel';

/**
 * A group of rows (DESIGN §9 «Grouped rows», #921): one `surface` block, radius 28, no border,
 * 16 inside, a hairline between rows. An optional grey `label` names the group. The rows are
 * `Row`s, or anything that brings its own vertical padding and none across.
 *
 * The hairline is drawn here, between children, so a row does not need to know whether it is
 * the first: a conditional row that renders `null` leaves no line behind. It stops 16 short of
 * each edge of the block, as the rows' text does.
 */
export function RowGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <View className="gap-3">
      {label ? <SectionLabel>{label}</SectionLabel> : null}
      <View className="overflow-hidden rounded-[28px] bg-surface px-4">
        {Children.toArray(children).map((child, i) => (
          // `toArray` drops `null` and gives every element a stable key.
          <Fragment key={isValidElement(child) ? child.key : i}>
            {i > 0 ? <View className="h-px bg-hair" /> : null}
            {child}
          </Fragment>
        ))}
      </View>
    </View>
  );
}
