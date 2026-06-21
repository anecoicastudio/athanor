import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { t } from '@athanor/i18n';
import {
  getVerificationStatus,
  requestVerification,
  subscribeVerifyStatus,
  verifyKeys,
} from '@athanor/api';
import { deriveVerifyState } from '@athanor/core';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { Mandorla } from '@/components/Mandorla';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

/**
 * Identity verify sheet (M9 §3.2). Starts a server-created Stripe Identity session, opens the
 * Stripe-hosted flow, then polls/subscribes profiles.identity_verified for the flip. The app
 * never writes identity_verified or any Aura (the +50 is the M6 engine's job, rule #1).
 */
export default function VerifyScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const me = profile?.id;
  const qc = useQueryClient();

  const [sessionPending, setSessionPending] = useState(false);
  const [error, setError] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const status = useQuery({
    queryKey: verifyKeys.status(),
    queryFn: () => getVerificationStatus(supabase),
    // poll while a session is in flight (realtime is the primary signal; poll is the backstop)
    refetchInterval: sessionPending ? 4000 : false,
  });

  const state = deriveVerifyState({
    identityVerified: status.data?.identityVerified ?? false,
    latestStatus: status.data?.latestStatus ?? null,
    sessionPending,
  });

  // Realtime: flip the moment the webhook sets the flag.
  useEffect(() => {
    if (!me) return;
    const cleanup = subscribeVerifyStatus(supabase, me, () => {
      void qc.invalidateQueries({ queryKey: verifyKeys.status() });
    });
    return cleanup;
  }, [me, qc]);

  // On verified: stop polling, toast, auto-dismiss.
  useEffect(() => {
    if (state !== 'verified') return;
    setSessionPending(false);
    setToast(t('trust.verify.toast.verified', locale));
    dismissTimer.current = setTimeout(() => router.back(), 1600);
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [state, locale, router]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    },
    [],
  );

  const start = useCallback(async () => {
    setError(false);
    try {
      const result = await requestVerification(supabase);
      const url = 'url' in result ? result.url : null;
      if (!url) throw new Error('no url'); // clientSecret/native path not used on SDK54 (web sheet only)
      setSessionPending(true);
      setToast(t('trust.verify.toast.started', locale));
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 1800);
      await WebBrowser.openAuthSessionAsync(url, 'athanor://verify');
      setSessionPending(false); // browser returned (completed OR cancelled) — re-enable CTA; realtime/poll flips to verified if it actually completed
      // back from the Stripe flow — refetch; realtime/poll carry the rest.
      void qc.invalidateQueries({ queryKey: verifyKeys.status() });
    } catch {
      setSessionPending(false);
      setError(true);
    }
  }, [locale, qc]);

  const verified = state === 'verified';

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 px-6 pb-10 pt-6">
      {/* grab handle */}
      <View className="mx-auto h-1 w-10 rounded-full bg-hair" />
      {/* head */}
      <View className="flex-row items-center justify-between">
        <Text className="text-xl font-bold text-foreground">{t('trust.verify.title', locale)}</Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', locale)}
          hitSlop={8}
        >
          <Text className="text-2xl text-muted-foreground">×</Text>
        </Pressable>
      </View>

      <View className="items-center gap-4 py-4">
        <View
          accessible={true}
          accessibilityLabel={
            verified ? t('verify.a11y.verified', locale) : t('verify.a11y.unverified', locale)
          }
        >
          <Mandorla size={92} glowLevel={verified ? 1 : 0.4}>
            <Text
              className="text-3xl text-aura"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {verified ? '✦' : '◇'}
            </Text>
          </Mandorla>
        </View>

        {verified ? (
          <Text className="text-center text-lg font-semibold text-aura">
            {t('trust.verify.success', locale)}
          </Text>
        ) : (
          <>
            <Text className="text-center text-[15px] leading-relaxed text-foreground">
              {t('trust.verify.sub', locale)}
            </Text>
            <Text className="text-center text-[13px] leading-snug text-muted-foreground">
              {t('trust.verify.privacy', locale)}
            </Text>
          </>
        )}
      </View>

      {error ? (
        <Text className="text-center text-sm text-error">{t('trust.verify.error', locale)}</Text>
      ) : null}

      {!verified ? (
        <Button
          variant="light"
          glow={state === 'pending'}
          disabled={state === 'pending'}
          label={
            state === 'pending'
              ? t('trust.verify.pending', locale)
              : state === 'failed'
                ? t('trust.verify.retry', locale)
                : t('trust.verify.cta', locale)
          }
          onPress={start}
        />
      ) : null}

      {toast ? (
        <View className="absolute inset-x-6 bottom-8 rounded-card bg-raise-2 px-4 py-3">
          <Text className="text-center text-sm text-foreground">{toast}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
