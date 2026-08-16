import type { RealizationPlanPhaseRow, RealizationUpdateRow } from '@athanor/api';
import type { Locale } from '@athanor/schemas';
import { t } from '@athanor/i18n';
import { Text, View } from '@/tw';
import { timeAgo } from '@/lib/time';

/**
 * One public progress note (#230, FUND-26) — what the winner said, when, and which plan
 * phase it was about.
 *
 * NO COUNTS OF ANY KIND (rule #3). There is no reaction, no view tally and no «N people are
 * following»: the table has no column that could carry one, and this card has no corner
 * where one could be added without noticing. The community follows the project; it does not
 * score it.
 *
 * Flat surface, no glow (rule #4). A progress note is the ordinary rhythm of a realization,
 * not a moment — the glow belongs to the events that only happen once.
 */
export function ProgressUpdateCard({
  update,
  phase,
  locale,
  now,
  footer,
}: {
  update: RealizationUpdateRow;
  /** The plan phase this note is about, when it names one and that phase still exists. */
  phase: RealizationPlanPhaseRow | null;
  locale: Locale;
  /** Pinned across a list pass so every row in one render agrees on «now». */
  now: number;
  /** The author's own controls, on the compose screen only — absent on the public feed. */
  footer?: React.ReactNode;
}) {
  return (
    <View className="gap-2 rounded-card border border-hair bg-raise p-5">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-[12px] text-muted-foreground">
          {timeAgo(update.created_at, locale, now)}
        </Text>
        {update.deleted_at ? (
          <Text className="text-[12px] text-muted-foreground">
            {t('fund.progress.withdrawn', locale)}
          </Text>
        ) : null}
      </View>

      {/* The phase link, when there is one. A note whose phase was erased with its plan
          simply loses the line — plan_phase_id is ON DELETE SET NULL, and a dangling
          «Fase ?» would be worse than no attribution at all. */}
      {phase ? (
        <Text className="text-[12px] text-aura">
          {t('fund.progress.phase', locale, { n: String(phase.sort), title: phase.title })}
        </Text>
      ) : null}

      <Text className="text-[15px] leading-6 text-foreground">{update.body}</Text>

      {footer}
    </View>
  );
}
