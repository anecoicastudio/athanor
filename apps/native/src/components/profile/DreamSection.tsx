import { useRouter } from 'expo-router';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { DreamCard } from '@/components/profile/DreamCard';
import { IncomingOfferRow } from '@/components/profile/IncomingOfferRow';
import type { OwnDream } from '@/hooks/use-own-dream';

/** Il Sogno — editable quote (dream editor) + tappe CRUD (M2) + owner-side «Aiuti in arrivo». */
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
        incoming.length > 0 ? (
          <View className="mt-2 gap-3 border-t border-hair pt-4">
            <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
              {t('help.owner.sectionLabel', locale)}
            </Text>
            {incoming
              .filter((h) => h.status === 'offered' || h.status === 'accepted')
              .map((h) => (
                <IncomingOfferRow
                  key={h.id}
                  help={h}
                  helperName={helperNames[h.helper_id] ?? '—'}
                  locale={locale}
                  mutating={mutatingHelpId === h.id}
                  onAccept={() => handleRespond(h.id, 'accepted')}
                  onDecline={() => handleRespond(h.id, 'declined')}
                  onConfirm={() => handleConfirmHelp(h.id, h.milestone_id)}
                />
              ))}
          </View>
        ) : null
      }
    />
  );
}
