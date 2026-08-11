import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  dreamKeys,
  getActiveDream,
  helpKeys,
  listMilestones,
  listMyHelpsForMilestones,
  milestoneKeys,
  offerHelp,
} from '@athanor/api';
import { t } from '@athanor/i18n';
import type { HelpType, Locale, Milestone } from '@athanor/schemas';
import { ScrollView, Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { ModalHeader } from '@/components/ModalHeader';
import { MilestoneRow } from '@/components/profile/MilestoneRow';
import { Toast } from '@/components/Toast';
import { useAuth } from '@/lib/auth-context';
import { helpableMilestones } from '@/lib/help-picker';
import { supabase } from '@/lib/supabase';
import { MODAL_A11Y } from '@/lib/a11y';
// A unique violation here means you already offered help on this tappa.
import { isUniqueViolation } from '@/lib/pg-error';

const HELP_TYPES: HelpType[] = ['skill', 'connection', 'opportunity'];

/**
 * Offer-help sheet (M2, frontend `02` §3.4B). A viewer offers help on someone else's
 * tappa («Aiuta») — skill / connection / opportunity, NO money (Fase 1). Full-screen
 * modal (project sheet convention = (modal)/* routes). Writes only milestone_helps via
 * the api; never Aura (rule #1). One offer per helper per tappa (DB unique → 23505).
 *
 * Two entry points, one sheet:
 *
 * - `milestoneId` (+ `need`): the per-tappa «Aiuta» — straight into type / message / submit.
 * - `userId`: «Fai accadere questo sogno» from the person's dream card or their story
 *   (PRD §132). The sheet first asks WHICH tappa, then continues into the same steps.
 *   Nothing to pick (no dream, or every open tappa already offered on) is an honest empty
 *   state with no CTA — never a toast claiming a write that did not happen (issue #108).
 *
 * TODO(M3): migrate to the Foundation Sheet host (bottom sheet) when it lands.
 */
export default function HelpScreen() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const locale: Locale = profile?.locale ?? 'it';
  const { milestoneId, need, userId } = useLocalSearchParams<{
    milestoneId?: string;
    need?: string;
    userId?: string;
  }>();

  const [picked, setPicked] = useState<Milestone | null>(null);
  const [type, setType] = useState<HelpType | null>(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'type' | 'already' | 'generic' | null>(null);
  const [toast, setToast] = useState(false);

  // Picker mode only when the caller named a person instead of a tappa. A `milestoneId`
  // always wins, so the per-tappa flow is byte-for-byte what it was.
  const pickerMode = !milestoneId && Boolean(userId);

  const dreamQuery = useQuery({
    queryKey: dreamKeys.byProfile(userId ?? ''),
    queryFn: () => getActiveDream(supabase, userId as string),
    enabled: pickerMode,
  });
  const dreamId = dreamQuery.data?.id ?? null;

  const milestonesQuery = useQuery({
    queryKey: milestoneKeys.list(dreamId ?? ''),
    queryFn: () => listMilestones(supabase, dreamId as string),
    enabled: pickerMode && dreamId != null,
  });
  const tappe = milestonesQuery.data ?? [];

  // Scoped to this dream's tappe, exactly as the person-detail card reads them: an unscoped
  // page of my newest offers could miss an older one on this dream and offer a tappa the
  // unique index forbids. The dream id joins the `mine` prefix so two dreams cannot share
  // one cache entry, while `helpKeys.mine` still invalidates both.
  const myHelpsQuery = useQuery({
    queryKey: [...helpKeys.mine(session?.user.id ?? ''), dreamId ?? ''],
    queryFn: () =>
      listMyHelpsForMilestones(
        supabase,
        session?.user.id as string,
        tappe.map((m) => m.id),
      ),
    enabled: pickerMode && Boolean(session) && tappe.length > 0,
  });

  const options = helpableMilestones(tappe, myHelpsQuery.data?.rows ?? []);

  // Still reading. Each leg only counts while it is actually enabled — a person with no
  // dream settles on the first query, and one with no tappe never runs the helps read.
  const pickerLoading =
    dreamQuery.isPending ||
    (dreamId != null && milestonesQuery.isPending) ||
    (tappe.length > 0 && myHelpsQuery.isPending);

  const submit = async () => {
    if (saving) return;
    // One id whichever way the sheet was entered — the picker feeds the same submit.
    const targetMilestoneId = milestoneId ?? picked?.id;
    if (!targetMilestoneId || !type || !session) {
      setError('type');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await offerHelp(supabase, session.user.id, {
        milestone_id: targetMilestoneId,
        type,
        message: message.trim() || undefined,
      });
      setToast(true);
      setTimeout(() => router.back(), 700);
    } catch (e) {
      if (isUniqueViolation(e)) {
        setError('already');
        setSaving(false);
      } else {
        setError('generic');
        setSaving(false);
      }
    }
  };

  // The picker step: shown until a tappa is chosen. Once `picked` is set the sheet falls
  // through to the very same type / message / submit the per-tappa entry point uses.
  if (pickerMode && !picked) {
    return (
      <View {...MODAL_A11Y} className="flex-1 bg-background">
        <ModalHeader title={t('help.pick.title', locale)} backLabel={t('common.back', locale)} />
        {pickerLoading ? (
          <View className="flex-1 items-center justify-center">
            <Text className="text-2xl text-muted-foreground">✦</Text>
          </View>
        ) : (
          <ScrollView className="flex-1" contentContainerClassName="gap-6 px-5 pb-12">
            {dreamQuery.data == null ? (
              <EmptyState>{t('help.pick.noDream', locale)}</EmptyState>
            ) : options.length === 0 ? (
              <EmptyState>{t('help.pick.noneLeft', locale)}</EmptyState>
            ) : (
              <View className="gap-4">
                <Text className="text-[15px] leading-relaxed text-faint">
                  {t('help.pick.hint', locale)}
                </Text>
                {options.map((m) => (
                  <MilestoneRow
                    key={m.id}
                    name={m.body}
                    status={m.status}
                    locale={locale}
                    helpState="available"
                    onHelp={() => setPicked(m)}
                  />
                ))}
              </View>
            )}
          </ScrollView>
        )}
      </View>
    );
  }

  // What the helper is answering: the caller's echo, or the tappa just picked.
  const needEcho = need ?? picked?.body;

  return (
    <View {...MODAL_A11Y} className="flex-1 bg-background">
      <ModalHeader
        title={t('help.sheet.title', locale)}
        backLabel={t('common.back', locale)}
        // Two steps, one sheet: from the type/message step, back returns to the tappa list
        // rather than dropping the member out of a flow they are halfway through.
        onBack={picked ? () => setPicked(null) : undefined}
      />
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        {needEcho ? (
          <Text className="text-[15px] leading-relaxed text-faint">
            {t('help.sheet.needEcho', locale, { need: needEcho })}
          </Text>
        ) : null}

        <View
          className="flex-row flex-wrap gap-2"
          accessibilityRole="radiogroup"
          accessibilityLabel={t('help.sheet.title', locale)}
        >
          {HELP_TYPES.map((option) => (
            <Chip
              key={option}
              label={t(`help.type.${option}`, locale)}
              selected={type === option}
              onPress={() => {
                setType(option);
                if (error === 'type') setError(null);
              }}
            />
          ))}
        </View>

        <TextInput
          className="min-h-36 rounded-hero border border-hair bg-raise px-5 py-4 text-lg text-foreground"
          multiline
          maxLength={500}
          editable={!saving}
          placeholder={t('help.message.placeholder', locale)}
          value={message}
          onChangeText={setMessage}
        />

        <Text className="text-[13px] leading-relaxed text-faint">{t('help.noMoney', locale)}</Text>

        {error === 'already' ? (
          <Text className="text-sm text-error">{t('help.alreadyOffered', locale)}</Text>
        ) : null}

        {/* flat light CTA — offering help is not itself moment-grade, so no glow (rule #4). */}
        <Button
          label={t('help.sheet.cta', locale)}
          variant="light"
          disabled={saving || type === null}
          onPress={submit}
        />
      </ScrollView>
      {toast ? <Toast label={t('help.toast.offered', locale)} /> : null}
    </View>
  );
}
