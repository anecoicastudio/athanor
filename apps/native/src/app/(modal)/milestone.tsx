import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { addMilestone } from '@athanor/api';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { ScrollView, Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
import { ModalHeader } from '@/components/ModalHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { Toast } from '@/components/Toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { MODAL_A11Y } from '@/lib/a11y';
import { Screen } from '@/components/Screen';

/**
 * Milestone composer (M2, frontend `02` §3.3 — sheet-milestone). Adds one tappa
 * («Mi serve…») to the active dream. Full-screen modal (project sheet convention =
 * (modal)/* routes). Writes only dream_milestones; never Aura (rule #1). Copy via i18n.
 * TODO(M3): migrate to the Foundation Sheet host (bottom sheet) when it lands.
 */
export default function MilestoneScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const locale: Locale = profile?.locale ?? 'it';
  const { dreamId } = useLocalSearchParams<{ dreamId?: string }>();

  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [toast, setToast] = useState(false);

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
      setToast(true);
      setTimeout(() => router.back(), 700);
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
          <TextInput
            className={`rounded-hero border bg-raise px-5 py-4 text-lg text-foreground ${
              error ? 'border-error' : 'border-hair'
            }`}
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

        {error ? (
          <Text className="text-sm text-error">{t('milestone.error.empty', locale)}</Text>
        ) : null}

        {/* flat light CTA — adding a tappa is not moment-grade, so no glow (rule #4). */}
        <Button
          label={t('milestone.sheet.cta', locale)}
          variant="light"
          disabled={saving}
          onPress={add}
        />
      </ScrollView>

      {toast ? <Toast label={t('milestone.toast.added', locale)} /> : null}
    </Screen>
  );
}
