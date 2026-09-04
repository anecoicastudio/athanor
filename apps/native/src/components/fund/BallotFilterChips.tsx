import { type Locale, type MessageKey, t } from '@athanor/i18n';
import { View } from '@/tw';
import type { BallotFilter } from '@/lib/ballot-card';
import { Chip } from '@/components/Chip';

/**
 * The ballot's category filter (#227, FUND-11/D43).
 *
 * WRAPS rather than scrolls. `ProjectFilterTabs` — the same enum, on Costellazioni — is a
 * horizontal ScrollView, but DESIGN.md §6 reserves horizontal carousels in the mobile app for
 * Home's event cards, and this row sits inside the fund modal's vertical scroll. At most six
 * chips wrap to two lines, which is what the candidacy wizard's own category picker does.
 *
 * Active = the Chip vocabulary (aura-soft fill + aura-line border). Flat cyan, no glow: a
 * ballot filter is a control, not a moment (rule #4).
 *
 * The caller decides whether the row exists at all — `ballotFilters` returns `[]` when fewer
 * than two categories are on the ballot, because «all» beside a single category is chrome
 * pretending to be a control.
 */
export function BallotFilterChips({
  filters,
  active,
  onChange,
  locale,
}: {
  filters: readonly BallotFilter[];
  active: BallotFilter;
  onChange: (f: BallotFilter) => void;
  locale: Locale;
}) {
  if (filters.length === 0) return null;
  return (
    <View
      // `radiogroup`, matching the `role="radio"` the chips below now declare — the container is
      // what makes «1 di 5» possible, and it is what the label belongs to (#635).
      //
      // Deliberately NOT `accessible`, unlike `AffinityRow`. That flag makes a view an atomic
      // accessibility ELEMENT, and an atomic ancestor swallows every control under it (#518) —
      // it is right for a leaf row of two `Text`s and wrong for a group of chips. The cost is
      // that iOS may not voice the group's own label; losing the five controls would be worse.
      accessibilityRole="radiogroup"
      className="flex-row flex-wrap gap-2"
      accessibilityLabel={t('fund.candidates.filter.a11y', locale)}
    >
      {filters.map((f) => (
        <Chip
          key={f}
          small
          role="radio"
          // Same keys the candidacy wizard and Costellazioni use — one vocabulary, one
          // label set, so a chip here and a chip there can never drift apart.
          label={t(`costellazioni.filter.${f}` as MessageKey, locale)}
          selected={f === active}
          onPress={() => onChange(f)}
        />
      ))}
    </View>
  );
}
