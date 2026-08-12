import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { blockKeys, blockUser, reportKeys, submitReport } from '@athanor/api';
import { t } from '@athanor/i18n';
import {
  type Locale,
  REPORT_CATEGORIES,
  type ReportCategory,
  type ReportTargetType,
} from '@athanor/schemas';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ModalHeader } from '@/components/ModalHeader';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { MODAL_A11Y } from '@/lib/a11y';
import { Screen } from '@/components/Screen';

/**
 * Report sheet (M9, frontend `09` §3.3). One sheet parameterized by targetType ∈
 * {person, post, behavior} + optional targetId. Files a `reports` row (status='open'); the
 * reporter NEVER sees the outcome — the −50..−200 Aura penalty, if upheld, is the M6 engine's
 * job, server-only (rule #1). After a person report, offers «Blocca anche questa persona»
 * (routes through the merged blocks flow). Flat `light` CTA — reporting is not a moment-grade
 * event, so no glow (rule #4). Neutral chrome (no cyan/glow surfaces).
 */
export default function ReportScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const locale: Locale = profile?.locale ?? 'it';
  const { targetType, targetId } = useLocalSearchParams<{
    targetType?: ReportTargetType;
    targetId?: string;
  }>();

  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [note, setNote] = useState('');
  // Track the auto-dismiss timer so an early close (✕) doesn't fire router.back() after unmount.
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    },
    [],
  );

  const report = useMutation({
    mutationFn: () =>
      submitReport(supabase, {
        targetType: targetType ?? 'behavior',
        targetId: targetId ?? null,
        category: category as ReportCategory,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reportKeys.mine() });
      // Confirmation auto-dismisses (~1.9s) unless this is a person report — there we keep
      // the sheet so the user can tap «Blocca anche questa persona».
      if (targetType !== 'person') dismissTimer.current = setTimeout(() => router.back(), 1900);
    },
  });

  const blockAlso = useMutation({
    mutationFn: () => blockUser(supabase, targetId as string),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: blockKeys.all });
      router.back();
    },
  });

  return (
    <Screen {...MODAL_A11Y}>
      {/* head — back + title + close x */}
      <ModalHeader
        title={t('report.title', locale)}
        backLabel={t('common.back', locale)}
        right={
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel', locale)}
            hitSlop={8}
          >
            <Text className="text-xl text-faint">✕</Text>
          </Pressable>
        }
      />
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        {report.isSuccess ? (
          // submitted — body swaps to the confirmation
          <View className="items-center gap-4 py-10">
            <Text className="text-3xl text-aura">✓</Text>
            <Text className="px-4 text-center text-[15px] leading-relaxed text-foreground">
              {t('report.confirm', locale)}
            </Text>
            {targetType === 'person' && targetId ? (
              <Pressable
                onPress={() => blockAlso.mutate()}
                disabled={blockAlso.isPending}
                accessibilityRole="button"
                hitSlop={8}
              >
                <Text className="pt-2 text-[15px] text-error">{t('report.alsoBlock', locale)}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <>
            <Text className="text-[15px] leading-relaxed text-faint">
              {t('report.sub', locale)}
            </Text>

            {/* reason picker — single-select radio group */}
            <View
              className="flex-row flex-wrap gap-2"
              accessibilityRole="radiogroup"
              accessibilityLabel={t('report.sub', locale)}
            >
              {REPORT_CATEGORIES.map((option) => (
                <Chip
                  key={option}
                  label={t(`report.reason.${option}`, locale)}
                  selected={category === option}
                  onPress={() => setCategory(option)}
                />
              ))}
            </View>

            {/* optional note */}
            <TextInput
              className="min-h-28 rounded-hero border border-hair bg-raise px-5 py-4 text-lg text-foreground"
              multiline
              maxLength={2000}
              editable={!report.isPending}
              placeholder={t('report.note.placeholder', locale)}
              value={note}
              onChangeText={setNote}
            />

            {report.isError ? (
              <Text className="text-sm text-error">{t('report.error', locale)}</Text>
            ) : null}

            {/* flat light CTA — reporting is not moment-grade, so no glow (rule #4). */}
            <Button
              label={report.isPending ? t('report.submitting', locale) : t('report.cta', locale)}
              variant="light"
              disabled={category === null || report.isPending}
              onPress={() => report.mutate()}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
