import { useWindowDimensions } from 'react-native';
import type { RealizationPlanPhaseRow, RealizationUpdateRow } from '@athanor/api';
import type { Locale } from '@athanor/schemas';
import { t } from '@athanor/i18n';
import { Text, View, cn } from '@/tw';
import { WellScope } from '@/components/Card';
import { timeAgo } from '@/lib/time';
import { stacksTrailing } from '@/lib/type-scale';

/**
 * One public progress note (#230, FUND-26) — what the winner said, when, and which plan
 * phase it was about.
 *
 * NO COUNTS OF ANY KIND (rule #3). There is no reaction, no view tally and no «N people are
 * following»: the table has no column that could carry one, and this block has no corner
 * where one could be added without noticing. The community follows the project; it does not
 * score it.
 *
 * The notes are rows of ONE group (Galleria, Marco 2026-10-09, #921): radius 28, 16 inside, a
 * hairline between them. Both lists that hold them are paged, so the group cannot be one
 * element: each note draws its own SEGMENT of it, as `feed/Comment` does. `first` rounds the
 * top, `last` rounds the foot, and every note but the first draws the hairline above itself.
 * Both default to true, which is a block of its own. Segments must touch: the view that holds
 * them sets no gap.
 *
 * No border, no cyan and no glow: a progress note is the ordinary rhythm of a realization, and
 * its phase is a grey line beside the time.
 */
export function ProgressUpdateCard({
  update,
  phase,
  locale,
  now,
  first = true,
  last = true,
  footer,
  children,
}: {
  update: RealizationUpdateRow;
  /** The plan phase this note is about, when it names one and that phase still exists. */
  phase: RealizationPlanPhaseRow | null;
  locale: Locale;
  /** Pinned across a list pass so every row in one render agrees on «now». */
  now: number;
  first?: boolean;
  last?: boolean;
  /** The author's own controls, on the compose screen only — absent on the public feed. */
  footer?: React.ReactNode;
  /**
   * Stands in place of the note's text: the author's correction field, on the compose screen
   * only. It is under `WellScope`, so a `Field` here is a black well.
   */
  children?: React.ReactNode;
}) {
  const large = stacksTrailing(useWindowDimensions().fontScale);
  const withdrawn = update.deleted_at != null;
  return (
    <WellScope>
      <View
        className={cn(
          'bg-surface px-4',
          first ? 'rounded-t-[28px]' : null,
          last ? 'rounded-b-[28px]' : null,
        )}
      >
        {first ? null : <View className="h-px bg-hair" />}
        <View className="gap-[10px] py-[14px]">
          {/* When, and the phase link when there is one. A note whose phase was erased with
              its plan simply loses the line — plan_phase_id is ON DELETE SET NULL, and a
              dangling «Fase ?» would be worse than no attribution at all. Side by side, the
              phase takes the room that is left; at the accessibility sizes it goes under. */}
          <View className={large ? 'gap-2' : 'flex-row items-start justify-between gap-3'}>
            <Text className="type-small text-muted-foreground">
              {timeAgo(update.created_at, locale, now)}
            </Text>
            {phase ? (
              <Text
                className={cn(
                  'type-small text-muted-foreground',
                  large ? null : 'flex-1 text-right',
                )}
              >
                {t('fund.progress.phase', locale, { n: String(phase.sort), title: phase.title })}
              </Text>
            ) : null}
          </View>

          {children ?? (
            <Text
              className={cn('type-body', withdrawn ? 'text-muted-foreground' : 'text-foreground')}
            >
              {update.body}
            </Text>
          )}

          {/* A withdrawn note has no control left: the word stands where they stood. */}
          {update.deleted_at ? (
            <Text className="type-small text-muted-foreground">
              {t('fund.progress.withdrawn', locale)}
            </Text>
          ) : (
            footer
          )}
        </View>
      </View>
    </WellScope>
  );
}
