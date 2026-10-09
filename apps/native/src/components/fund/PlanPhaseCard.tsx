import { useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform, useWindowDimensions } from 'react-native';
import { formatFundTotal } from '@athanor/core';
import { t } from '@athanor/i18n';
import { Pressable, Text, View, cn } from '@/tw';
import { WellScope } from '@/components/Card';
import { Field } from '@/components/Field';
import { SectionLabel } from '@/components/SectionLabel';
import type { DraftPhase } from '@/lib/plan-draft';
import { PRESS_DIM } from '@/lib/press';
import { calendarDay, dayKey, parseCalendarDay } from '@/lib/time';
import { stacksTrailing } from '@/lib/type-scale';

type Locale = 'it' | 'en';

/** «Fase 2 · I primi corsi»: the number, and the title once it has one. */
function phaseHead(phase: DraftPhase, index: number, locale: Locale): string {
  return [t('fund.plan.phase.n', locale, { n: index + 1 }), phase.title.trim()]
    .filter(Boolean)
    .join(' · ');
}

/**
 * One phase of a realization plan (#229) while the plan is a draft — the three facts a tranche
 * release reads, plus a title: when, how much, and what its verification is judged against.
 *
 * A FOLD (Galleria, Marco 2026-10-09, #921): one charcoal group, radius 28, whose first row
 * says the phase in a line («Fase 1 · Il forno e i banchi · € 6.000») and opens the fields
 * under it. The plan screen owns which folds are open: shut at rest, any number open at once,
 * a new phase open, and a phase a refused save found unfinished opened for the member. The row
 * is a button that carries the `expanded` state; its chevron is the character a row draws,
 * turned down while the fold is shut and up while it is open. `Row` has neither that state nor
 * a chevron that turns, which is why the row is written here.
 *
 * The fields are black wells: the fold's fill is the fields' own, so `WellScope` puts them
 * under the flag a `Card` sets. «Quando» is not a text field; it is a button in the one-line
 * field's shape, which writes the well itself and is named by its label and its date.
 *
 * Not this file's own PhaseList: that component walks the CYCLE's five phases
 * (candidacy → realization). These are the plan's tranches, a different thing with the same
 * word — the reason both keep a qualified name.
 */
export function PlanPhaseCard({
  phase,
  index,
  locale,
  open,
  onToggle,
  onChange,
  onRemove,
}: {
  phase: DraftPhase;
  index: number;
  locale: Locale;
  open: boolean;
  onToggle: () => void;
  onChange: (next: DraftPhase) => void;
  onRemove: () => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const large = stacksTrailing(useWindowDimensions().fontScale);
  // Whole euros: a tranche is a project cost, not a till receipt. Empty stays empty so the
  // field can be cleared without the amount silently becoming zero.
  const euro = phase.amountCents === null ? '' : String(Math.round(phase.amountCents / 100));
  // The cost joins the line only once the member has typed one: «€ 0» would be a claim.
  const summary = [
    phaseHead(phase, index, locale),
    phase.amountCents === null ? null : formatFundTotal(phase.amountCents, locale),
  ]
    .filter(Boolean)
    .join(' · ');
  const titleLabel = t('fund.plan.phase.title.label', locale);
  const dateLabel = t('fund.plan.phase.date.label', locale);
  const amountLabel = t('fund.plan.phase.amount.label', locale);
  const criteriaLabel = t('fund.plan.phase.criteria.label', locale);
  const when = calendarDay(phase.scheduledFor, locale);

  return (
    <WellScope>
      <View className="rounded-[28px] bg-surface px-4">
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={summary}
          className={cn('min-h-[60px] flex-row items-center justify-between gap-3 py-2', PRESS_DIM)}
        >
          <Text className="flex-1 type-body font-medium text-foreground">{summary}</Text>
          <View style={{ transform: [{ rotate: open ? '-90deg' : '90deg' }] }}>
            <Text className="type-small text-muted-foreground">›</Text>
          </View>
        </Pressable>

        {open ? (
          <View className="gap-[14px] pb-[18px] pt-1">
            {/* None of these fields has a placeholder to speak for it, so each takes the
                label above it as its name. */}
            <View className="gap-1.5">
              <SectionLabel>{titleLabel}</SectionLabel>
              <Field
                accessibilityLabel={titleLabel}
                value={phase.title}
                onChangeText={(title) => onChange({ ...phase, title })}
              />
            </View>

            <View className="gap-1.5">
              <SectionLabel>{dateLabel}</SectionLabel>
              <Pressable
                onPress={() => setShowPicker(true)}
                accessibilityRole="button"
                accessibilityLabel={[dateLabel, when].join(', ')}
                className={cn(
                  'min-h-[50px] justify-center rounded-full bg-background px-5 py-[13px]',
                  PRESS_DIM,
                )}
              >
                <Text className="type-body text-foreground">{when}</Text>
              </Pressable>
              {showPicker ? (
                <DateTimePicker
                  value={parseCalendarDay(phase.scheduledFor)}
                  mode="date"
                  onChange={(_, picked) => {
                    setShowPicker(Platform.OS === 'ios');
                    // dayKey reads local parts, which is the same calendar day the picker
                    // showed — the DATE column stores a day, never an instant.
                    if (picked) onChange({ ...phase, scheduledFor: dayKey(picked.toISOString()) });
                  }}
                />
              ) : null}
            </View>

            <View className="gap-1.5">
              <SectionLabel>{amountLabel}</SectionLabel>
              <Field
                accessibilityLabel={amountLabel}
                value={euro}
                onChangeText={(text) => {
                  const digits = text.replace(/[^0-9]/g, '');
                  onChange({
                    ...phase,
                    amountCents: digits === '' ? null : Number(digits) * 100,
                  });
                }}
                keyboardType="number-pad"
                placeholder={t('fund.plan.phase.amount.hint', locale)}
              />
            </View>

            <View className="gap-1.5">
              <SectionLabel>{criteriaLabel}</SectionLabel>
              <Field
                multiline
                accessibilityLabel={criteriaLabel}
                value={phase.criteria}
                onChangeText={(criteria) => onChange({ ...phase, criteria })}
              />
            </View>

            {/* A 44pt target around a 21pt line, and it DELETES a phase (§10). `-my-3` gives
                back what the target adds; not at the accessibility sizes, where the line fills
                its target. */}
            <Pressable
              onPress={onRemove}
              accessibilityRole="button"
              className={cn(
                'min-h-[44px] justify-center self-start',
                large ? null : '-my-3',
                PRESS_DIM,
              )}
            >
              <Text className="type-small text-foreground underline">
                {t('fund.plan.phase.remove', locale)}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </WellScope>
  );
}

/**
 * The same phase once the plan is published: a block of the plan's one group of phases, and
 * nothing to open or type into (Marco, 2026-10-09). Publication is not a mode of the fold: the
 * phases are then the public commitment tranches release against, and the database refuses a
 * client write on them, so the block shows the same facts as text rather than fields that
 * would silently fail. It brings its own vertical padding and none across, as `RowGroup` asks.
 */
export function PlanPhaseFacts({
  phase,
  index,
  locale,
}: {
  phase: DraftPhase;
  index: number;
  locale: Locale;
}) {
  const large = stacksTrailing(useWindowDimensions().fontScale);
  return (
    <View className="gap-[10px] py-[14px]">
      <View className={large ? 'gap-2' : 'flex-row items-start justify-between gap-3'}>
        <Text className={cn('type-body font-medium text-foreground', large ? null : 'flex-1')}>
          {phaseHead(phase, index, locale)}
        </Text>
        <Text className="type-body text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
          {formatFundTotal(phase.amountCents ?? 0, locale)}
        </Text>
      </View>
      <Text className="type-small text-muted-foreground">
        {calendarDay(phase.scheduledFor, locale)}
      </Text>
      <Text className="type-body text-foreground">{phase.criteria}</Text>
    </View>
  );
}
