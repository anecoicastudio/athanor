import type { ReactNode } from 'react';
import { galleria } from '@athanor/config';
import { Pressable, Text } from '@/tw';
import { t } from '@athanor/i18n';
import type { Locale, Milestone } from '@athanor/schemas';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DreamQuote } from '@/components/DreamQuote';
import { EmptyState } from '@/components/EmptyState';
import { AddIcon } from '@/components/glyphs';
import { Row } from '@/components/Row';
import { RowGroup } from '@/components/RowGroup';
import { SectionLabel } from '@/components/SectionLabel';
import type { HelpState } from '@/lib/help-picker';
import { PRESS_DIM } from '@/lib/press';
import { MilestoneRow } from './MilestoneRow';

/**
 * Il Sogno — the one active dream (frontend `02` §3.1). Three blocks of the screen, returned
 * side by side so the caller's 26 stands between them:
 *
 * 1. the card — the profile's ONE bordered card (DESIGN §6): the label and the quote, nothing
 *    else. The shared `Card`.
 * 2. «Le tappe del sogno» — a `RowGroup` of `MilestoneRow`s (the tappe sat inside the card,
 *    under a hairline, until 2026-10-05).
 * 3. `incomingSlot` — «Aiuti in arrivo», a second group the owner's screen passes in.
 *
 * Two variants:
 *
 * - `own` (default): the owner's editable dream. Tap the quote (or the empty-state CTA)
 *   to open the dream editor; the tappe group ends with the «Aggiungi una tappa» row.
 * - `read`: someone else's dream (person-detail). Label is `dream.theirLabel`, the quote
 *   is read-only (no editor), each tappa shows the «Aiuta» affordance via `helpStateById`/
 *   `onHelpMilestone`, and the add-tappa row is hidden. The empty state shows no owner CTA.
 *
 * Both variants render the «Fai accadere questo sogno» rally CTA (the `primary` pill, inside
 * the card) when a dream is present and `onMakeHappen` is wired. Never writes Aura.
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
    <>
      <Card>
        <SectionLabel>{t(isRead ? 'dream.theirLabel' : 'dream.ownLabel', locale)}</SectionLabel>
        {dream ? (
          /*
            Label = the dream, hint = the action (#356, #635). This Pressable masks `DreamQuote`,
            so a label of «Modifica il tuo sogno» announced the BUTTON and never the quote — the
            one piece of content on the card. Worse on `read`: the label is not gated on
            `isRead`, so a screen-reader user on someone else's profile heard "edit YOUR dream"
            over their dream. Two keys, own and their, mirroring the `dream.ownLabel` /
            `dream.theirLabel` pair the label above already uses.

            The hint rides only on the editable arm. On `read` the Pressable is `disabled` and
            does nothing, so promising an action there would be the same lie in a quieter
            register.
          */
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(
              isRead ? 'dream.a11y.theirQuote' : 'dream.a11y.ownQuote',
              locale,
              { dream },
            )}
            accessibilityHint={isRead || !onEdit ? undefined : t('dream.a11y.editQuote', locale)}
            className={PRESS_DIM}
            disabled={isRead || !onEdit}
            onPress={isRead ? undefined : onEdit}
          >
            <DreamQuote text={dream} />
          </Pressable>
        ) : (
          // Ghost, not primary — DESIGN §9's empty-state action is always the ghost (#119).
          <EmptyState
            action={
              !isRead && onEdit
                ? { label: t('dream.empty.cta', locale), onPress: onEdit }
                : undefined
            }
          >
            {t('dream.empty.title', locale)}
          </EmptyState>
        )}

        {dream && onMakeHappen ? (
          <Button
            label={t('dream.makeHappenCta', locale)}
            variant="primary"
            onPress={onMakeHappen}
          />
        ) : null}
      </Card>

      {showTappe ? (
        <RowGroup label={t('milestone.sectionLabel', locale)}>
          {milestones.length === 0 ? (
            <Text className="py-4 type-small text-muted-foreground">
              {t('milestone.empty.hint', locale)}
            </Text>
          ) : null}
          {milestones.map((m) =>
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
          )}
          {/* The add row is a `Row` led by the drawn `add` (a typed «＋» in cyan until
              2026-10-05), named by its label. */}
          {!isRead && onAddMilestone ? (
            <Row
              leading={<AddIcon color={galleria.foreground} />}
              title={t('milestone.addRow', locale)}
              showChevron={false}
              onPress={onAddMilestone}
            />
          ) : null}
        </RowGroup>
      ) : null}

      {!isRead && showTappe ? incomingSlot : null}
    </>
  );
}
