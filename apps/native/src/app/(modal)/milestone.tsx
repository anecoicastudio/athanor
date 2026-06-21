import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { addMilestone } from '@athanor/api';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { MODAL_A11Y } from '@/lib/a11y';

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
    <ScrollView
      {...MODAL_A11Y}
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 px-5 py-12"
      keyboardShouldPersistTaps="handled"
    >
      <View className="flex-row items-center gap-4">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', locale)}
          hitSlop={8}
        >
          <Text className="text-2xl text-foreground">‹</Text>
        </Pressable>
        <Text accessibilityRole="header" className="text-xl font-semibold text-foreground">
          {t('milestone.sheet.title', locale)}
        </Text>
      </View>

      <Text className="text-[15px] leading-relaxed text-faint">
        {t('milestone.sheet.desc', locale)}
      </Text>

      <View className="gap-2">
        <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-aura">
          {t('milestone.field.label', locale)}
        </Text>
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

      {toast ? (
        <View className="absolute inset-x-5 bottom-10 items-center rounded-card border border-hair bg-raise-2 px-5 py-3">
          <Text className="text-sm text-foreground">{t('milestone.toast.added', locale)}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
