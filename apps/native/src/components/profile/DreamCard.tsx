import type { ReactNode } from 'react';
import { Pressable, Text, View } from '@/tw';
import { t } from '@athanor/i18n';
import type { Locale, Milestone } from '@athanor/schemas';
import { Button } from '@/components/Button';
import { DreamQuote } from '@/components/DreamQuote';
import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';
import type { HelpState } from '@/lib/help-picker';
import { MilestoneRow } from './MilestoneRow';

/**
 * Il Sogno — the one active dream (frontend `02` §3.1). Two variants:
 *
 * - `own` (default): the owner's editable card. Tap the quote (or the empty-state CTA)
 *   to open the dream editor; the card hosts the tappe list + "+ Aggiungi una tappa" row,
 *   and an optional `incomingSlot` («Aiuti in arrivo») under the tappe.
 * - `read`: someone else's dream (person-detail). Label is `dream.theirLabel`, the quote
 *   is read-only (no editor), each tappa shows the «Aiuta» affordance via `helpStateById`/
 *   `onHelpMilestone`, and the add-tappa row is hidden. The empty state shows no owner CTA.
 *
 * Both variants render the «Fai accadere questo sogno» rally CTA (flat `light`, never the
 * glow — rule #4) when a dream is present and `onMakeHappen` is wired. Never writes Aura.
 */
export function DreamCard({
  dream,
  locale,
  variant = 'own',
  onEdit,
  milestones,
  mutatingMilestoneId,
  onAddMilestone,
  onMarkMilestoneDone,
  onDeleteMilestone,
  helpStateById,
  onHelpMilestone,
  incomingSlot,
  onMakeHappen,
}: {
  dream: string | null;
  locale: Locale;
  variant?: 'own' | 'read';
  onEdit?: () => void;
  milestones?: Milestone[];
  mutatingMilestoneId?: string | null;
  onAddMilestone?: () => void;
  onMarkMilestoneDone?: (id: string) => void;
  onDeleteMilestone?: (id: string) => void;
  helpStateById?: Record<string, HelpState>;
  onHelpMilestone?: (milestoneId: string) => void;
  incomingSlot?: ReactNode;
  onMakeHappen?: () => void;
}) {
  const isRead = variant === 'read';
  const showTappe = milestones !== undefined && dream != null;

  return (
    <View className="gap-3 rounded-card border border-hair bg-raise p-5">
      <SectionLabel tone="aura">
        {t(isRead ? 'dream.theirLabel' : 'dream.ownLabel', locale)}
      </SectionLabel>
      {dream ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('dream.a11y.editQuote', locale)}
          disabled={isRead || !onEdit}
          onPress={isRead ? undefined : onEdit}
        >
          <DreamQuote text={dream} />
        </Pressable>
      ) : (
        // Ghost, not primary — DESIGN §9's empty-state action is always the ghost (#119).
        <EmptyState
          action={
            !isRead && onEdit ? { label: t('dream.empty.cta', locale), onPress: onEdit } : undefined
          }
        >
          {t('dream.empty.title', locale)}
        </EmptyState>
      )}

      {showTappe ? (
        <View className="mt-2 gap-3 border-t border-hair pt-4">
          <SectionLabel>{t('milestone.sectionLabel', locale)}</SectionLabel>

          {milestones.length === 0 ? (
            <Text className="text-[13px] text-faint">{t('milestone.empty.hint', locale)}</Text>
          ) : (
            milestones.map((m) =>
              isRead ? (
                <MilestoneRow
                  key={m.id}
                  name={m.body}
                  status={m.status}
                  locale={locale}
                  helpState={helpStateById?.[m.id] ?? 'available'}
                  onHelp={onHelpMilestone ? () => onHelpMilestone(m.id) : undefined}
                />
              ) : (
                <MilestoneRow
                  key={m.id}
                  name={m.body}
                  status={m.status}
                  locale={locale}
                  mutating={mutatingMilestoneId === m.id}
                  onMarkDone={onMarkMilestoneDone ? () => onMarkMilestoneDone(m.id) : undefined}
                  onDelete={onDeleteMilestone ? () => onDeleteMilestone(m.id) : undefined}
                />
              ),
            )
          )}

          {!isRead && onAddMilestone ? (
            <Pressable
              accessibilityRole="button"
              className="flex-row items-center gap-3 pt-1"
              hitSlop={8}
              onPress={onAddMilestone}
            >
              <Text className="text-base text-aura">＋</Text>
              <Text className="text-[15px] text-faint">{t('milestone.addRow', locale)}</Text>
            </Pressable>
          ) : null}

          {!isRead ? incomingSlot : null}
        </View>
      ) : null}

      {dream && onMakeHappen ? (
        <Button label={t('dream.makeHappenCta', locale)} variant="light" onPress={onMakeHappen} />
      ) : null}
    </View>
  );
}
