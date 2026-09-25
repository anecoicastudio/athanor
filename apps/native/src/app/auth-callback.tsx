import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { t } from '@athanor/i18n';
import { ScrollView, Text, View } from '@/tw';
import { Screen } from '@/components/Screen';
import { LoadingScreen } from '@/components/LoadingScreen';
import { Button } from '@/components/Button';
import { RecoverySent } from '@/components/RecoverySent';
import { useDraftLocale } from '@/hooks/use-draft-locale';
import { useAnnounceOnMount } from '@/lib/a11y';
import { authErrorKey, callbackFailureKind } from '@/lib/auth-errors';
import { AUTH_REDIRECT_URL } from '@/lib/oauth';
import {
  clearRecoveryRequest,
  readRecoveryRequest,
  rememberRecoveryRequest,
} from '@/lib/recovery-request';
import { supabase } from '@/lib/supabase';

/**
 * Deep-link target for the signup-confirmation mail (`emailRedirectTo` in
 * (auth)/welcome.tsx, shared with lib/oauth.ts as AUTH_REDIRECT_URL) and for the
 * password-recovery mail ((auth)/forgot-password.tsx).
 *
 * The OAuth flow never routes here: `WebBrowser.openAuthSessionAsync` intercepts
 * the redirect in-process and exchanges the code itself. An email link is a real
 * OS deep link, so it lands on this route instead — and with `flowType: 'pkce'`
 * (lib/supabase.ts) the confirmation carries `?code=…`, which is worthless unless
 * something calls exchangeCodeForSession. Without this screen the account is
 * confirmed server-side, the app opens, the code is dropped, and the user is
 * silently still signed out.
 *
 * On success there is nothing to route: AuthGuard (_layout.tsx) treats this
 * segment like (auth) and sends a complete profile to (tabs), an incomplete one
 * to (onboarding).
 *
 * On failure the link is spent whatever the cause — auth-js deletes the code-verifier on every
 * exchange attempt — so the only way forward is a new mail. GoTrue keeps the flow state 300 s
 * from the request and mail can arrive later than that (#863), so a dead recovery link is the
 * common case, not the edge. When lib/recovery-request.ts remembers the address this device
 * asked a reset for, the screen names it and offers the resend in one tap; without it (a
 * signup confirmation, or a request older than the mail link itself) it says the gate has
 * closed and points to sign-in, as before.
 */
const EXCHANGE_TIMEOUT_MS = 15_000;

export default function AuthCallbackScreen() {
  // expo-router yields string[] for a repeated query param. GoTrue never sends one,
  // but the narrow type would be a lie and exchangeCodeForSession would get an array.
  const params = useLocalSearchParams<{
    code?: string | string[];
    error_description?: string;
  }>();
  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  const errorDescription = params.error_description;
  const router = useRouter();
  // GoTrue appends ?error=…&error_description=… instead of a code when the link is expired or
  // already consumed. That is knowable during render, so it is derived — only the exchange's
  // own failure needs state (#691).
  const invalidLink = Boolean(errorDescription) || !code;
  const [exchangeFailure, setExchangeFailure] = useState<'network' | 'dead' | null>(null);
  const failure = invalidLink ? 'dead' : exchangeFailure;
  // undefined while the stash is being read, so the resend offer never flickers in late.
  const [recoveryEmail, setRecoveryEmail] = useState<string | null | undefined>(undefined);
  const [resend, setResend] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [resendError, setResendError] = useState<string | null>(null);
  // Draft-aware (#158): the OTP link lands here while the draft (and its chosen
  // locale) is still on disk — the flush clears it only after the exchange.
  const locale = useDraftLocale();

  useEffect(() => {
    if (invalidLink || !code) return;
    let cancelled = false;
    // AuthGuard deliberately does not redirect away from this route, so a request
    // that never settles would leave the user on a bare ✦ with no way out — the one
    // inescapable state in the tree. Bound it and fall through to the error UI, as the
    // transport failure it is (status 0, see callbackFailureKind).
    const timeout = new Promise<{ error: { status: number } }>((resolve) =>
      setTimeout(() => resolve({ error: { status: 0 } }), EXCHANGE_TIMEOUT_MS),
    );
    Promise.race([supabase.auth.exchangeCodeForSession(code), timeout])
      .then(({ error }) => {
        if (cancelled) return;
        if (error) {
          if (__DEV__)
            console.warn(
              '[auth] callback exchange',
              error.status,
              'code' in error ? error.code : undefined,
            );
          setExchangeFailure(callbackFailureKind(error));
        } else {
          void clearRecoveryRequest();
        }
      })
      .catch(() => {
        if (!cancelled) setExchangeFailure('network');
      });
    return () => {
      cancelled = true;
    };
  }, [code, invalidLink]);

  useEffect(() => {
    if (!failure) return;
    let cancelled = false;
    void readRecoveryRequest().then((email) => {
      if (!cancelled) setRecoveryEmail(email);
    });
    return () => {
      cancelled = true;
    };
  }, [failure]);

  const message =
    failure === 'network'
      ? t('auth.error.network', locale)
      : recoveryEmail
        ? t('auth.callback.expired', locale, { email: recoveryEmail })
        : t('auth.error.invalidLink', locale);

  // The failure replaces a bare spinner, so nothing on iOS would otherwise say what happened;
  // after that, the resend's own transitions (G2, the same two forgot-password announces).
  useAnnounceOnMount(
    !failure || recoveryEmail === undefined
      ? undefined
      : (resendError ??
          (resend === 'sending'
            ? t('auth.forgot.sending', locale)
            : resend === 'sent'
              ? t('auth.forgot.sent.title', locale)
              : message)),
  );

  const sendAgain = async () => {
    if (!recoveryEmail) return;
    setResend('sending');
    setResendError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(recoveryEmail, {
      redirectTo: AUTH_REDIRECT_URL,
    });
    if (error) {
      if (__DEV__) console.warn('[auth] resend recovery', error.status, error.code);
      setResend('idle');
      setResendError(t(authErrorKey(error), locale));
      return;
    }
    await rememberRecoveryRequest(recoveryEmail);
    setResend('sent');
  };

  const toLogin = () =>
    // mode:'login' or welcome renders the SIGNUP copy — and someone whose
    // confirmation link expired already has an account, so the signup form
    // would only answer them with «email already taken».
    router.replace({ pathname: '/(auth)/welcome', params: { mode: 'login' } });

  if (!failure || recoveryEmail === undefined) return <LoadingScreen />;

  if (resend === 'sent' && recoveryEmail) {
    return (
      <Screen>
        <ScrollView className="flex-1" contentContainerClassName="grow px-5 pb-9 pt-4">
          <RecoverySent
            email={recoveryEmail}
            locale={locale}
            onChangeEmail={() => router.replace('/(auth)/forgot-password')}
          />
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <View className="flex-1 items-center justify-center gap-6 px-8">
        <Text className="text-center text-base text-muted-foreground">{message}</Text>
        <View className="gap-3 self-stretch">
          {recoveryEmail ? (
            <Button
              variant="light"
              label={t('auth.callback.resend', locale)}
              loading={resend === 'sending'}
              disabled={resend === 'sending'}
              onPress={sendAgain}
            />
          ) : null}
          {/* Under the control it is about, like the OAuth line in welcome.tsx (#855). */}
          {resendError ? (
            <Text className="text-center text-sm text-error" accessibilityLiveRegion="polite">
              {resendError}
            </Text>
          ) : null}
          <Button variant="outline" label={t('auth.login.cta', locale)} onPress={toLogin} />
        </View>
      </View>
    </Screen>
  );
}
