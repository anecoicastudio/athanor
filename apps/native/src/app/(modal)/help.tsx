import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { offerHelp } from '@athanor/api';
import { t } from '@athanor/i18n';
import type { HelpType, Locale } from '@athanor/schemas';
import { ScrollView, Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ModalHeader } from '@/components/ModalHeader';
import { Toast } from '@/components/Toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { MODAL_A11Y } from '@/lib/a11y';

/** A Postgres unique-violation (23505) — you already offered help on this tappa. */
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === '23505'
  );
}

const HELP_TYPES: HelpType[] = ['skill', 'connection', 'opportunity'];

/**
 * Offer-help sheet (M2, frontend `02` §3.4B). A viewer offers help on someone else's
 * tappa («Aiuta») — skill / connection / opportunity, NO money (Fase 1). Full-screen
 * modal (project sheet convention = (modal)/* routes). Writes only milestone_helps via
 * the api; never Aura (rule #1). One offer per helper per tappa (DB unique → 23505).
 * TODO(M3): migrate to the Foundation Sheet host (bottom sheet) when it lands.
 */
export default function HelpScreen() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const locale: Locale = profile?.locale ?? 'it';
  const { milestoneId, need } = useLocalSearchParams<{ milestoneId?: string; need?: string }>();

  const [type, setType] = useState<HelpType | null>(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'type' | 'already' | 'generic' | null>(null);
  const [toast, setToast] = useState(false);

  const submit = async () => {
    if (saving) return;
    if (!milestoneId || !type || !session) {
      setError('type');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await offerHelp(supabase, session.user.id, {
        milestone_id: milestoneId,
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

  return (
    <View {...MODAL_A11Y} className="flex-1 bg-background">
      <ModalHeader title={t('help.sheet.title', locale)} backLabel={t('common.back', locale)} />
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        {need ? (
          <Text className="text-[15px] leading-relaxed text-faint">
            {t('help.sheet.needEcho', locale, { need })}
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
