import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { t } from '@athanor/i18n';
import { requestErasure } from '@athanor/api';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { ModalHeader } from '@/components/ModalHeader';
import { useToast } from '@/components/ToastHost';
import { useLocale } from '@/hooks/use-locale';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { MODAL_A11Y } from '@/lib/a11y';
import { Screen } from '@/components/Screen';

/**
 * GDPR right-to-erasure / store-mandated in-app account deletion (09 §3.5.2, 12 §3.3, Apple 5.1.1(v)).
 * Type-to-confirm «ELIMINA» → requestErasure (inserts a gdpr_erasure_requests row) → immediate
 * sign-out. The server cascade + legally-retained records are the service-role erasure-job — the app
 * only requests. Destructive `danger` CTA, no glow (rule #4).
 *
 * The copy is split in two on purpose (#515): `body` is what the job does at once and cannot
 * undo, `deferred` is what waits for the nightly job. Keep it that way — collapsing them back
 * into one paragraph is how the screen came to promise, at the tap, a deletion that happens
 * later. Since #107 «later» is a night rather than never, and since #733 the tap also bans
 * sign-in in the same transaction as the request; the copy says both. The split is still the
 * point: what the tap does at once (session, sign-in) versus what the job does at night.
 */
export default function DeleteAccountScreen() {
  const router = useRouter();
  const { signOut: endSession } = useAuth();
  const locale = useLocale();
  const [confirm, setConfirm] = useState('');
  const { showToast } = useToast();

  const word = t('account.delete.confirmWord', locale);
  const matched = confirm.trim().toUpperCase() === word.toUpperCase();

  const erase = useMutation({
    mutationFn: () => requestErasure(supabase),
    onSuccess: () => {
      showToast(t('account.delete.toast', locale), 'success');
      // Immediate sign-out — the AuthGuard routes to (auth)/welcome (mirrors settings.tsx signOut).
      // Immediately, not on a timer (#733). The 700 ms setTimeout this used to be was cancelled
      // on unmount and skipped when the app was backgrounded, and either left a session alive
      // on an account whose request has already banned it: refresh would fail and every write
      // would be denied, behind a UI that still looked signed in. ToastProvider sits in the root
      // layout above the router, so the toast survives the AuthGuard's route to welcome.
      endSession().catch(() => undefined);
    },
    onError: () => showToast(t('profile.error', locale)),
  });

  return (
    <Screen {...MODAL_A11Y}>
      <ModalHeader title={t('account.delete.title', locale)} backLabel={t('common.back', locale)} />
      <ScrollView className="flex-1" contentContainerClassName="gap-6 px-5 pb-12">
        <Text className="text-[15px] leading-relaxed text-muted-foreground">
          {t('account.delete.body', locale)}
        </Text>

        {/* #515 — what the job does NOT do at the tap. The account cascade runs on the nightly
            erasure job (#107, 03:47 UTC), not here, so the original copy («cancelleremo il tuo
            profilo… definitivamente») promised at the tap a completion that arrives later. Kept
            as its own line rather than folded into the body: the two halves say different things
            — one is irreversible and immediate, the other is irreversible and not. */}
        <Text className="text-[14px] leading-relaxed text-muted-foreground">
          {t('account.delete.deferred', locale)}
        </Text>

        {/* honesty line — export before delete (routes to the export sheet) */}
        <Pressable
          onPress={() => router.replace('/(modal)/data-export')}
          accessibilityRole="button"
          className="min-h-[44px] justify-center"
        >
          <Text className="text-[14px] text-aura">{t('account.delete.exportFirst', locale)}</Text>
        </Pressable>

        <View className="gap-2">
          <Text className="text-[13px] text-muted-foreground">
            {t('account.delete.confirmField', locale)}
          </Text>
          <Input
            value={confirm}
            onChangeText={setConfirm}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={word}
            accessibilityLabel={t('account.delete.confirmField', locale)}
          />
        </View>

        <Button
          variant="danger"
          label={t('account.delete.cta', locale)}
          disabled={!matched || erase.isPending || erase.isSuccess}
          onPress={() => erase.mutate()}
        />
      </ScrollView>
    </Screen>
  );
}
