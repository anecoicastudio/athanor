import { Pressable, Text, View } from '@/tw';
import { t } from '@athanor/i18n';
import type { Locale, Milestone } from '@athanor/schemas';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { MilestoneRow } from './MilestoneRow';

/**
 * Il Sogno — the one active dream, in the owner's words (frontend `02` §3.1).
 * Editable (M2): tap the quote (or the empty-state CTA) to open the dream editor.
 * When `milestones` is provided (own mode) the card also hosts the tappe list +
 * "+ Aggiungi una tappa" row. Read mode (no milestone props) renders quote only.
 */
export function DreamCard({
  dream,
  locale,
  onEdit,
  milestones,
  mutatingMilestoneId,
  onAddMilestone,
  onMarkMilestoneDone,
  onDeleteMilestone,
}: {
  dream: string | null;
  locale: Locale;
  onEdit?: () => void;
  milestones?: Milestone[];
  mutatingMilestoneId?: string | null;
  onAddMilestone?: () => void;
  onMarkMilestoneDone?: (id: string) => void;
  onDeleteMilestone?: (id: string) => void;
}) {
  const showTappe = milestones !== undefined && dream != null;

  return (
    <View className="gap-3 rounded-card border border-hair bg-raise p-5">
      <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-aura">
        {t('dream.ownLabel', locale)}
      </Text>
      {dream ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('dream.a11y.editQuote', locale)}
          disabled={!onEdit}
          onPress={onEdit}
        >
          <Text className="font-dream text-xl leading-relaxed text-foreground">«{dream}»</Text>
        </Pressable>
      ) : (
        <View className="gap-3">
          <EmptyState>{t('dream.empty.title', locale)}</EmptyState>
          {onEdit ? (
            <Button label={t('dream.empty.cta', locale)} variant="primary" onPress={onEdit} />
          ) : null}
        </View>
      )}

      {showTappe ? (
        <View className="mt-2 gap-3 border-t border-hair pt-4">
          <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
            {t('milestone.sectionLabel', locale)}
          </Text>

          {milestones.length === 0 ? (
            <Text className="text-[13px] text-faint">{t('milestone.empty.hint', locale)}</Text>
          ) : (
            milestones.map((m) => (
              <MilestoneRow
                key={m.id}
                name={m.body}
                status={m.status}
                locale={locale}
                mutating={mutatingMilestoneId === m.id}
                onMarkDone={onMarkMilestoneDone ? () => onMarkMilestoneDone(m.id) : undefined}
                onDelete={onDeleteMilestone ? () => onDeleteMilestone(m.id) : undefined}
              />
            ))
          )}

          {onAddMilestone ? (
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
        </View>
      ) : null}
    </View>
  );
}
