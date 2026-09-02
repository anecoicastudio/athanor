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
 * It hand-rolled the Chip vocabulary — the same `border-aura-line bg-aura-soft` fill, the same
 * six keys `BallotFilterChips` already renders through `Chip` — but none of the contract behind
 * it: six bare `Pressable`s with no role and no `selected`, so which filter was active reached a
 * screen reader as cyan and nothing else. `small` is deliberate: it is the compact variant AND
 * the only one carrying the 44pt floor these pills already had, so routing through the default
 * variant would have regressed a target #638 records as correct.
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
          small
          label={t(`costellazioni.filter.${f}` as MessageKey, locale)}
          selected={f === active}
          onPress={() => onChange(f)}
        />
      ))}
    </ScrollView>
  );
}
