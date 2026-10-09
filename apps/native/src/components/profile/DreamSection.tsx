import { useRouter } from 'expo-router';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { DreamCard } from '@/components/profile/DreamCard';
import { IncomingOfferRow } from '@/components/profile/IncomingOfferRow';
import { RowGroup } from '@/components/RowGroup';
import type { OwnDream } from '@/hooks/use-own-dream';

/**
 * Il Sogno — editable quote (dream editor) + tappe CRUD (M2) + owner-side «Aiuti in arrivo»,
 * a group of its own under the tappe: one block per offer still to answer or to confirm.
 */
export function DreamSection({ locale, dream }: { locale: Locale; dream: OwnDream }) {
  const router = useRouter();
  const {
    dreamText,
    dreamId,
    milestones,
    mutatingMilestoneId,
    incoming,
    helperNames,
    mutatingHelpId,
    handleMarkMilestoneDone,
    handleDeleteMilestone,
    handleRespond,
    handleConfirmHelp,
  } = dream;
  // Filtered BEFORE the group is built: a list holding only declined or completed offers must
  // not leave a label over an empty block.
  const pending = incoming.filter((h) => h.status === 'offered' || h.status === 'accepted');

  return (
    <DreamCard
      dream={dreamText}
      locale={locale}
      onEdit={() => router.push('/(modal)/dream-editor')}
      milestones={milestones}
      mutatingMilestoneId={mutatingMilestoneId}
      onAddMilestone={() =>
        router.push({ pathname: '/(modal)/milestone', params: { dreamId: dreamId ?? '' } })
      }
      onMarkMilestoneDone={handleMarkMilestoneDone}
      onDeleteMilestone={handleDeleteMilestone}
      incomingSlot={
        pending.length > 0 ? (
          <RowGroup label={t('help.owner.sectionLabel', locale)}>
            {pending.map((h) => (
              <IncomingOfferRow
                key={h.id}
                help={h}
                helper={helperNames[h.helper_id] ?? null}
                locale={locale}
                mutating={mutatingHelpId === h.id}
                onAccept={() => handleRespond(h.id, 'accepted')}
                onDecline={() => handleRespond(h.id, 'declined')}
                onConfirm={() => handleConfirmHelp(h.id, h.milestone_id)}
              />
            ))}
          </RowGroup>
        ) : null
      }
    />
  );
}
