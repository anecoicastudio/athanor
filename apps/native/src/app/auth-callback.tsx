import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { t } from '@athanor/i18n';
import { Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { useDraftLocale } from '@/hooks/use-draft-locale';
import { supabase } from '@/lib/supabase';

/**
 * Deep-link target for the signup-confirmation mail (`emailRedirectTo` in
 * (auth)/welcome.tsx, shared with lib/oauth.ts as AUTH_REDIRECT_URL).
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
 */
const EXCHANGE_TIMEOUT_MS = 15_000;

export default function AuthCallbackScreen() {
  // expo-router yields string[] for a repeated query param. GoTrue never sends one,
  // but the narrow type would be a lie and exchangeCodeForSession would get an array.
  const params = useLocalSearchParams<{ code?: string | string[]; error_description?: string }>();
  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  const errorDescription = params.error_description;
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  // Draft-aware (#158): the OTP link lands here while the draft (and its chosen
  // locale) is still on disk — the flush clears it only after the exchange.
  const locale = useDraftLocale();

  useEffect(() => {
    // GoTrue appends ?error=…&error_description=… instead of a code when the link
    // is expired or already consumed.
    if (errorDescription || !code) {
      setFailed(true);
      return;
    }
    let cancelled = false;
    // AuthGuard deliberately does not redirect away from this route, so a request
    // that never settles would leave the user on a bare ✦ with no way out — the one
    // inescapable state in the tree. Bound it and fall through to the error UI.
    const timeout = new Promise<{ error: { message: string } }>((resolve) =>
      // i18n-ignore — a sentinel for the race below, matched by identity, never rendered.
      setTimeout(() => resolve({ error: { message: 'timeout' } }), EXCHANGE_TIMEOUT_MS),
    );
    Promise.race([supabase.auth.exchangeCodeForSession(code), timeout])
      .then(({ error }) => {
        if (!cancelled && error) setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code, errorDescription]);

  if (failed) {
    return (
      <View className="flex-1 items-center justify-center gap-6 bg-background px-8">
        <Text className="text-center text-base text-muted-foreground">
          {t('auth.error.invalidLink', locale)}
        </Text>
        <Button
          variant="outline"
          label={t('auth.login.cta', locale)}
          // mode:'login' or welcome renders the SIGNUP copy — and someone whose
          // confirmation link expired already has an account, so the signup form
          // would only answer them with «email already taken».
          onPress={() => router.replace({ pathname: '/(auth)/welcome', params: { mode: 'login' } })}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Text className="text-2xl text-muted-foreground">✦</Text>
    </View>
  );
}
