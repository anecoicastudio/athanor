import { type Locale, type MessageKey, t } from '@athanor/i18n';
import type { ProjectCategory } from '@athanor/schemas';
import { ScrollView } from '@/tw';
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
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2 px-5"
    >
      {FILTERS.map((f) => (
        <Chip
          key={f}
          label={t(`costellazioni.filter.${f}` as MessageKey, locale)}
          selected={f === active}
          onPress={() => onChange(f)}
        />
      ))}
    </ScrollView>
  );
}
