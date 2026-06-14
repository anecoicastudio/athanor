import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { getActiveDream, upsertActiveDream } from '@auria/api';
import { t } from '@auria/i18n';
import type { Locale } from '@auria/schemas';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

/**
 * Dream editor (M2, frontend `02` §3.2) — create-or-edit the single active dream.
 * Full-screen modal (the project's sheet convention is (modal)/* routes). Writes
 * only dreams.text via upsertActiveDream; never Aura (rule #1). Copy via @auria/i18n.
 * TODO(M3): migrate to the Foundation Sheet host (bottom sheet) when it lands.
 */
export default function DreamEditorScreen() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const locale: Locale = profile?.locale ?? 'it';
  const userId = session?.user.id;

  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [toast, setToast] = useState(false);

  // Prefill with the current active dream when editing (empty draft when none).
  useEffect(() => {
    if (!userId) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    getActiveDream(supabase, userId)
      .then((d) => {
        if (!cancelled) setText(d?.text ?? '');
      })
      .catch(() => {
        // empty draft is the safe default
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const save = async () => {
    if (!userId || saving) return;
    if (text.trim().length === 0) {
      setError(true);
      return;
    }
    setSaving(true);
    setError(false);
    try {
      await upsertActiveDream(supabase, userId, text);
      setToast(true);
      setTimeout(() => router.back(), 700);
    } catch {
      setError(true);
      setSaving(false);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 px-5 py-12"
      keyboardShouldPersistTaps="handled"
    >
      {/* head: back + title */}
      <View className="flex-row items-center gap-4">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', locale)}
          hitSlop={8}
        >
          <Text className="text-2xl text-foreground">‹</Text>
        </Pressable>
        <Text className="text-xl font-semibold text-foreground">
          {t('dream.editor.title', locale)}
        </Text>
      </View>

      <Text className="text-[15px] leading-relaxed text-faint">
        {t('dream.editor.sub', locale)}
      </Text>

      <TextInput
        className={`min-h-36 rounded-hero border bg-raise px-5 py-4 font-dream text-lg text-foreground ${
          error ? 'border-error' : 'border-hair'
        }`}
        multiline
        maxLength={500}
        editable={loaded && !saving}
        placeholder={t('dream.editor.placeholder', locale)}
        value={text}
        onChangeText={(v) => {
          setText(v);
          if (error) setError(false);
        }}
      />

      {error ? <Text className="text-sm text-error">{t('dream.error.empty', locale)}</Text> : null}

      {/* light = moment-grade per rule #4: lighting your dream ✦ (spec §3.2). */}
      <Button
        label={t('dream.editor.cta', locale)}
        variant="light"
        disabled={saving || !loaded}
        onPress={save}
      />

      {toast ? (
        <View className="absolute inset-x-5 bottom-10 items-center rounded-card border border-hair bg-raise-2 px-5 py-3">
          <Text className="text-sm text-foreground">{t('dream.toast.saved', locale)}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
