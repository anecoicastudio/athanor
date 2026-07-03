import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import { requestErasure } from '@athanor/api';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
import { ModalHeader } from '@/components/ModalHeader';
import { Toast } from '@/components/Toast';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { MODAL_A11Y } from '@/lib/a11y';

/**
 * GDPR right-to-erasure / store-mandated in-app account deletion (09 §3.5.2, 12 §3.3, Apple 5.1.1(v)).
 * Type-to-confirm «ELIMINA» → requestErasure (inserts a gdpr_erasure_requests row) → immediate
 * sign-out. The server cascade + legally-retained records are the service-role erasure-job — the app
 * only requests. Destructive `danger` CTA, no glow (rule #4).
 */
export default function DeleteAccountScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const [confirm, setConfirm] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signOutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }, []);
  // Clear pending timers on unmount so they can't fire on a dead component.
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (signOutTimer.current) clearTimeout(signOutTimer.current);
    },
    [],
  );

  const word = t('account.delete.confirmWord', locale);
  const matched = confirm.trim().toUpperCase() === word.toUpperCase();

  const erase = useMutation({
    mutationFn: () => requestErasure(supabase),
    onSuccess: () => {
      flashToast(t('account.delete.toast', locale));
      // Immediate sign-out — the AuthGuard routes to (auth)/welcome (mirrors settings.tsx signOut).
      signOutTimer.current = setTimeout(() => {
        supabase.auth.signOut().catch(() => undefined);
      }, 700);
    },
    onError: () => flashToast(t('profile.error', locale)),
  });

  return (
    <View {...MODAL_A11Y} className="flex-1 bg-background">
      <ModalHeader title={t('account.delete.title', locale)} backLabel={t('common.back', locale)} />
      <ScrollView className="flex-1" contentContainerClassName="gap-6 px-5 pb-[104px]">
        <Text className="text-[15px] leading-relaxed text-muted-foreground">
          {t('account.delete.body', locale)}
        </Text>

        {/* honesty line — export before delete (routes to the export sheet) */}
        <Pressable
          onPress={() => router.replace('/(modal)/data-export')}
          accessibilityRole="button"
        >
          <Text className="text-[14px] text-aura">{t('account.delete.exportFirst', locale)}</Text>
        </Pressable>

        <View className="gap-2">
          <Text className="text-[13px] text-muted-foreground">
            {t('account.delete.confirmField', locale)}
          </Text>
          <TextInput
            value={confirm}
            onChangeText={setConfirm}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={word}
            placeholderTextColor={semantic.faint}
            className="rounded-full border border-hair bg-raise px-4 py-3 text-base text-foreground"
            accessibilityLabel={t('account.delete.confirmField', locale)}
          />
        </View>

        <Button
          variant="danger"
          label={t('account.delete.cta', locale)}
          disabled={!matched || erase.isPending}
          onPress={() => erase.mutate()}
        />
      </ScrollView>
      {toast ? <Toast label={toast} /> : null}
    </View>
  );
}
