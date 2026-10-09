import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { addMilestone } from '@athanor/api';
import { t } from '@athanor/i18n';
import { ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { ModalHeader } from '@/components/ModalHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { useToast } from '@/components/ToastHost';
import { useDirtyGuard } from '@/hooks/use-dirty-guard';
import { useLocale } from '@/hooks/use-locale';
import { isDraftDirty } from '@/lib/dirty-guard';
import { supabase } from '@/lib/supabase';
import { MODAL_A11Y } from '@/lib/a11y';
import { useGuardedBack } from '@/lib/modal-exit';
import { Screen } from '@/components/Screen';

/**
 * Milestone composer (M2, frontend `02` §3.3 — sheet-milestone). Adds one tappa
 * («Mi serve…») to the active dream. Full-screen modal (project sheet convention =
 * (modal)/* routes). Writes only dream_milestones; never Aura (rule #1). Copy via i18n.
 * The (modal) route IS the sheet: the Foundation Sheet host M3 once planned was never built,
 * and no open issue revives it (as of 2026-09-26).
 *
 * Galleria (#921, 2026-10-09; DESIGN §8.12): three blocks 26 apart on the stage, no card. A
 * small grey sentence, the label 6 above its one-line field, the white pill.
 */
export default function MilestoneScreen() {
  const leave = useGuardedBack();
  const locale = useLocale();
  const { dreamId } = useLocalSearchParams<{ dreamId?: string }>();

  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const { showToast } = useToast();

  // `saving` stays true across the 700ms farewell below, so the success path never confirms.
  useDirtyGuard({ dirty: isDraftDirty('', body), saving });

  const add = async () => {
    if (saving) return;
    if (!dreamId || body.trim().length === 0) {
      setError(true);
      return;
    }
    setSaving(true);
    setError(false);
    try {
      await addMilestone(supabase, { dream_id: dreamId, body });
      // The host keeps the toast alive across the pop (#117).
      showToast(t('milestone.toast.added', locale), 'moment');
      setTimeout(leave, 700);
    } catch {
      setError(true);
      setSaving(false);
    }
  };

  return (
    <Screen {...MODAL_A11Y}>
      <ModalHeader
        title={t('milestone.sheet.title', locale)}
        backLabel={t('common.back', locale)}
      />

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-[26px] px-5 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="type-small text-muted-foreground">
          {t('milestone.sheet.desc', locale)}
        </Text>

        <View className="gap-1.5">
          <SectionLabel>{t('milestone.field.label', locale)}</SectionLabel>
          <Field
            error={error ? t('milestone.error.empty', locale) : null}
            maxLength={200}
            editable={!saving}
            placeholder={t('milestone.field.placeholder', locale)}
            value={body}
            onChangeText={(v) => {
              setBody(v);
              if (error) setError(false);
            }}
          />
        </View>

        <Button
          label={t('milestone.sheet.cta', locale)}
          variant="primary"
          disabled={saving}
          onPress={add}
        />
      </ScrollView>
    </Screen>
  );
}
