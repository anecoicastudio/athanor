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
import { useLocale } from '@/hooks/use-locale';
import { supabase } from '@/lib/supabase';
import { MODAL_A11Y } from '@/lib/a11y';
import { useGuardedBack } from '@/lib/modal-exit';
import { Screen } from '@/components/Screen';

/**
 * Milestone composer (M2, frontend `02` §3.3 — sheet-milestone). Adds one tappa
 * («Mi serve…») to the active dream. Full-screen modal (project sheet convention =
 * (modal)/* routes). Writes only dream_milestones; never Aura (rule #1). Copy via i18n.
 * TODO(M3): migrate to the Foundation Sheet host (bottom sheet) when it lands.
 */
export default function MilestoneScreen() {
  const leave = useGuardedBack();
  const locale = useLocale();
  const { dreamId } = useLocalSearchParams<{ dreamId?: string }>();

  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const { showToast } = useToast();

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
        contentContainerClassName="gap-6 px-5 pb-12 pt-4"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-[15px] leading-relaxed text-faint">
          {t('milestone.sheet.desc', locale)}
        </Text>

        <View className="gap-2">
          <SectionLabel tone="aura">{t('milestone.field.label', locale)}</SectionLabel>
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

        {/* flat light CTA — adding a tappa is not moment-grade, so no glow (rule #4). */}
        <Button
          label={t('milestone.sheet.cta', locale)}
          variant="light"
          disabled={saving}
          onPress={add}
        />
      </ScrollView>
    </Screen>
  );
}
