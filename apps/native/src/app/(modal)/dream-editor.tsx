import { useEffect, useState } from 'react';
import { getActiveDream, upsertActiveDream } from '@athanor/api';
import { t } from '@athanor/i18n';
import { ScrollView, Text } from '@/tw';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { ModalHeader } from '@/components/ModalHeader';
import { useToast } from '@/components/ToastHost';
import { useLocale } from '@/hooks/use-locale';
import { useAuth } from '@/lib/auth-context';
import { useGuardedBack } from '@/lib/modal-exit';
import { supabase } from '@/lib/supabase';
import { Screen } from '@/components/Screen';

/**
 * Dream editor (M2, frontend `02` §3.2) — create-or-edit the single active dream.
 * Full-screen modal (the project's sheet convention is (modal)/* routes). Writes
 * only dreams.text via upsertActiveDream; never Aura (rule #1). Copy via @athanor/i18n.
 * TODO(M3): migrate to the Foundation Sheet host (bottom sheet) when it lands.
 */
export default function DreamEditorScreen() {
  const leave = useGuardedBack();
  const { session } = useAuth();
  const locale = useLocale();
  const userId = session?.user.id;

  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const { showToast } = useToast();

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
      // The host keeps the toast alive across the pop (#117).
      showToast(t('dream.toast.saved', locale), 'moment');
      setTimeout(leave, 700);
    } catch {
      setError(true);
      setSaving(false);
    }
  };

  return (
    <Screen>
      {/* head: back + title */}
      <ModalHeader title={t('dream.editor.title', locale)} backLabel={t('common.back', locale)} />

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-[15px] leading-relaxed text-faint">
          {t('dream.editor.sub', locale)}
        </Text>

        <Field
          size="lg"
          register="dream"
          error={error ? t('dream.error.empty', locale) : null}
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

        {/* light + glow = moment-grade per rule #4: lighting your dream ✦ (spec §3.2). */}
        <Button
          label={t('dream.editor.cta', locale)}
          variant="light"
          glow
          disabled={saving || !loaded}
          onPress={save}
        />
      </ScrollView>
    </Screen>
  );
}
