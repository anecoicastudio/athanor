import { useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform } from 'react-native';
import { formatFundTotal } from '@athanor/core';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import { Pressable, Text, TextInput, View } from '@/tw';
import { SectionLabel } from '@/components/SectionLabel';
import type { DraftPhase } from '@/lib/plan-draft';
import { calendarDay, dayKey, parseCalendarDay } from '@/lib/time';

/**
 * One phase of a realization plan (#229) — the three facts a tranche release reads, plus a
 * title: when, how much, and what its verification is judged against.
 *
 * `readOnly` is publication, not a mode toggle: once the plan is published the phases are
 * the public commitment tranches release against, and the database refuses a client write
 * on them. The card renders the same facts without inputs rather than showing fields that
 * would silently fail.
 *
 * Not this file's own PhaseList: that component walks the CYCLE's five phases
 * (candidacy → realization). These are the plan's tranches, a different thing with the same
 * word — the reason both keep a qualified name.
 */
export function PlanPhaseCard({
  phase,
  index,
  locale,
  readOnly,
  onChange,
  onRemove,
}: {
  phase: DraftPhase;
  index: number;
  locale: 'it' | 'en';
  readOnly: boolean;
  onChange: (next: DraftPhase) => void;
  onRemove: () => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  // Whole euros: a tranche is a project cost, not a till receipt. Empty stays empty so the
  // field can be cleared without the amount silently becoming zero.
  const euro = phase.amountCents === null ? '' : String(Math.round(phase.amountCents / 100));

  const field = (label: string) => <SectionLabel>{label}</SectionLabel>;

  return (
    <View className="gap-3 rounded-card border border-hair bg-raise p-5">
      <View className="flex-row items-center justify-between">
        <SectionLabel>{t('fund.plan.phase.n', locale, { n: index + 1 })}</SectionLabel>
        {!readOnly ? (
          <Pressable
            onPress={onRemove}
            accessibilityRole="button"
            // 12px label, no padding, no slop — a ~15pt target that DELETES a phase (§10).
            className="min-h-[44px] min-w-[44px] items-center justify-center"
          >
            <Text className="text-[12px] text-muted-foreground">
              {t('fund.plan.phase.remove', locale)}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {readOnly ? (
        <View className="gap-2">
          <Text className="text-[15px] font-semibold text-foreground">{phase.title}</Text>
          <Text className="text-[13px] text-muted-foreground">
            {calendarDay(phase.scheduledFor, locale)}
          </Text>
          <Text className="text-[15px] text-aura">
            {formatFundTotal(phase.amountCents ?? 0, locale)}
          </Text>
          <Text className="text-[13px] leading-5 text-foreground">{phase.criteria}</Text>
        </View>
      ) : (
        <>
          <View className="gap-2">
            {field(t('fund.plan.phase.title.label', locale))}
            <TextInput
              className="rounded-full border border-hair bg-background p-4 text-[15px] text-foreground"
              value={phase.title}
              onChangeText={(title) => onChange({ ...phase, title })}
              placeholderTextColor={semantic.foregroundMuted}
            />
          </View>

          <View className="gap-2">
            {field(t('fund.plan.phase.date.label', locale))}
            <Pressable
              onPress={() => setShowPicker(true)}
              className="rounded-card border border-hair bg-background p-4"
              accessibilityRole="button"
            >
              <Text className="text-[15px] text-foreground">
                {calendarDay(phase.scheduledFor, locale)}
              </Text>
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

          <View className="gap-2">
            {field(t('fund.plan.phase.amount.label', locale))}
            <TextInput
              className="rounded-full border border-hair bg-background p-4 text-[15px] text-foreground"
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
              placeholderTextColor={semantic.foregroundMuted}
            />
          </View>

          <View className="gap-2">
            {field(t('fund.plan.phase.criteria.label', locale))}
            <TextInput
              className="rounded-card border border-hair bg-background p-4 text-[15px] text-foreground"
              value={phase.criteria}
              onChangeText={(criteria) => onChange({ ...phase, criteria })}
              multiline
              placeholderTextColor={semantic.foregroundMuted}
            />
          </View>
        </>
      )}
    </View>
  );
}
