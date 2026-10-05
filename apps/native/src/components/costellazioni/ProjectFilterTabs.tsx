import { useEffect, useRef } from 'react';
import type { ScrollView as RNScrollView } from 'react-native';
import { type Locale, type MessageKey, t } from '@athanor/i18n';
import type { ProjectCategory } from '@athanor/schemas';
import { ScrollView, View } from '@/tw';
import { Chip } from '@/components/Chip';

export type ProjectFilter = ProjectCategory | 'all';
const FILTERS: ProjectFilter[] = [
  'all',
  'startup',
  'artistic',
  'business',
  'scientific',
  'volunteer',
];

/**
 * Horizontal board filter row, built from `Chip` (#635).
 *
 * It hand-rolled what `Chip` drew then — the same `border-aura-line bg-aura-soft` fill, the same
 * six keys `BallotFilterChips` already renders through `Chip` — but none of the contract behind
 * it: six bare `Pressable`s with no role and no `selected`, so which filter was active reached a
 * screen reader as cyan and nothing else. Since 2026-10-04 `Chip` has one size, a foreground
 * fill when selected, and the 44pt target #638 records for these pills through its own
 * `hitSlop`.
 *
 * `py-1.5` on the content keeps that `hitSlop` inside the row's own box, and the row brings a
 * selected chip that is off screen back to the gutter, on layout and on selection, as
 * `feed/CategoryTabs` does (#921, 2026-10-05).
 */
export function ProjectFilterTabs({
  active,
  onChange,
  locale,
}: {
  active: ProjectFilter;
  onChange: (f: ProjectFilter) => void;
  locale: Locale;
}) {
  const scroller = useRef<RNScrollView>(null);
  const starts = useRef<Partial<Record<ProjectFilter, number>>>({});
  const reveal = (x: number) => scroller.current?.scrollTo({ x: x - 20, animated: false });
  useEffect(() => {
    const x = starts.current[active];
    if (x !== undefined) reveal(x);
  }, [active]);
  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="items-center gap-2 px-5 py-1.5"
    >
      {FILTERS.map((f) => (
        <View
          key={f}
          onLayout={(e) => {
            starts.current[f] = e.nativeEvent.layout.x;
            if (f === active) reveal(e.nativeEvent.layout.x);
          }}
        >
          <Chip
            label={t(`costellazioni.filter.${f}` as MessageKey, locale)}
            selected={f === active}
            onPress={() => onChange(f)}
          />
        </View>
      ))}
    </ScrollView>
  );
}
