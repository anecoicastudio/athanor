import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { t, type MessageKey } from '@athanor/i18n';
import {
  getVerificationStatus,
  requestVerification,
  subscribeVerifyStatus,
  VerificationSessionError,
  verifyKeys,
} from '@athanor/api';
import { deriveVerifyState } from '@athanor/core';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { Mandorla } from '@/components/Mandorla';
import { useToast } from '@/components/ToastHost';
import { useLocale } from '@/hooks/use-locale';
import { useAuth } from '@/lib/auth-context';
import { useGuardedBack } from '@/lib/modal-exit';
import { supabase } from '@/lib/supabase';
import { Screen } from '@/components/Screen';

// The server's `{error}` strings are the stable contract (#103 idiom) — create-verification-session
// on one side, this map on the other. A configuration refusal (Identity not activated on the
// account, a key without the permission, an API-version mismatch) is not something retrying can
// fix, so it must not read as «Riprova» (#416). An unmapped string degrades to the generic copy.
const VERIFY_ERROR_COPY: Record<string, MessageKey> = {
  'verification unavailable': 'trust.verify.unavailable',
};

/**
 * Identity verify sheet (M9 §3.2). Starts a server-created Stripe Identity session, opens the
 * Stripe-hosted flow, then polls/subscribes profiles.identity_verified for the flip. The app
 * never writes identity_verified or any Aura (the +50 is the M6 engine's job, rule #1).
 */
export default function VerifyScreen() {
  const leave = useGuardedBack();
  const { profile, refreshProfile } = useAuth();
  const locale = useLocale();
  const me = profile?.id;
  const qc = useQueryClient();

  const [sessionPending, setSessionPending] = useState(false);
  // null = no failure. Otherwise the copy key for the failure the server named (#416).
  const [error, setError] = useState<MessageKey | null>(null);
  const { showToast } = useToast();
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

  // On verified: stop polling, toast (survives the pop via the host, #117), auto-dismiss.
  // Only on a WITNESSED flip (#634): the effect used to fire on first commit for a member who
  // arrived already verified (deep link, athanor://verify return on a cold stack), handing them
  // an unearned success toast and ~1.6s later an eject — to Home, because on those entry paths
  // there is nothing to pop back to. An already-verified visitor now just sees the verified
  // state and leaves on their own.
  const sawUnverified = useRef(false);
  useEffect(() => {
    if (state !== 'verified') {
      sawUnverified.current = true;
      return;
    }
    if (!sawUnverified.current) return;
    setSessionPending(false);
    // Re-read the AuthContext profile (#412). This query flipping is NOT enough: the context
    // hydrates `profile` once per session (auth-context keys that effect on [userId, email],
    // both stable, and onAuthStateChange re-reads it on nothing), so without this every screen
    // gating on `profile.identity_verified` stays refused until the app restarts — including
    // candidacy step 4, whose upload buttons now refuse on exactly that flag.
    void refreshProfile();
    showToast(t('trust.verify.toast.verified', locale), 'moment');
    dismissTimer.current = setTimeout(leave, 1600);
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [state, locale, leave, showToast, refreshProfile]);

  useEffect(
    () => () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    },
    [],
  );

  const start = useCallback(async () => {
    setError(null);
    try {
      const result = await requestVerification(supabase);
      const url = 'url' in result ? result.url : null;
      if (!url) throw new Error('no url'); // clientSecret/native path not used on SDK54 (web sheet only)
      setSessionPending(true);
      showToast(t('trust.verify.toast.started', locale), 'success');
      await WebBrowser.openAuthSessionAsync(url, 'athanor://verify');
      setSessionPending(false); // browser returned (completed OR cancelled) — re-enable CTA; realtime/poll flips to verified if it actually completed
      // back from the Stripe flow — refetch; realtime/poll carry the rest.
      void qc.invalidateQueries({ queryKey: verifyKeys.status() });
    } catch (e) {
      setSessionPending(false);
      const code = e instanceof VerificationSessionError ? e.code : undefined;
      setError((code ? VERIFY_ERROR_COPY[code] : undefined) ?? 'trust.verify.error');
    }
  }, [locale, qc, showToast]);

  const verified = state === 'verified';

  return (
    <Screen>
      <ScrollView className="flex-1" contentContainerClassName="gap-5 px-5 pb-10 pt-6">
        {/* grab handle */}
        <View className="mx-auto h-1 w-10 rounded-full bg-hair" />
        {/* head */}
        <View className="flex-row items-center justify-between gap-3">
          <Text className="flex-1 text-xl font-bold text-foreground" numberOfLines={2}>
            {t('trust.verify.title', locale)}
          </Text>
          <Pressable
            onPress={leave}
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

        {error ? <Text className="text-center text-sm text-error">{t(error, locale)}</Text> : null}

        {!verified ? (
          <Button
            variant="light"
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
      </ScrollView>
    </Screen>
  );
}
