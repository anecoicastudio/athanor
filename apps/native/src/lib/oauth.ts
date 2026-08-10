import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { createURL } from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { Provider } from '@supabase/supabase-js';
import { supabase } from './supabase';

/**
 * Browser-based OAuth (the only Expo-Go-compatible path — native sign-in modules
 * need a dev build, which the SDK-54 setup deliberately avoids). PKCE flow:
 * `signInWithOAuth({ skipBrowserRedirect: true })` returns the authorize URL and
 * stashes the code-verifier through the session-storage adapter (LargeSecureStore
 * on native) → open it in the system auth browser →
 * exchange the returned `?code` for a session. `exchangeCodeForSession` fires
 * onAuthStateChange('SIGNED_IN'), so auth-context drives routing + draft flush
 * exactly as the OTP path does — no extra wiring here.
 *
 * Note: Hermes has no `crypto.subtle`, so auth-js falls back to
 * `code_challenge_method=plain` (still valid PKCE, accepted by Supabase).
 */
export type OAuthOutcome =
  | { status: 'signed-in' }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

// Must match an entry in Supabase → Auth → Additional Redirect URLs. createURL
// resolves to `athanor://auth-callback` standalone and `exp://…/--/auth-callback`
// in Expo Go.
//
// Exported because the email signup in (auth)/welcome.tsx passes the same value as
// emailRedirectTo — without it the confirmation mail falls back to the project's
// Site URL, which points at the website, not at the app. OAuth normally never routes
// to src/app/auth-callback.tsx — openAuthSessionAsync intercepts the redirect below
// and exchanges the code here — whereas the email link always does, arriving as a
// real OS deep link. "Normally": if the OS ever hands an OAuth redirect to the app as
// a deep link instead, both call sites would exchange the same code and the loser
// would surface a spurious error. Dormant while both providers are disabled.
export const AUTH_REDIRECT_URL = createURL('/auth-callback');

export async function signInWithProvider(provider: 'apple' | 'google'): Promise<OAuthOutcome> {
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: provider as Provider,
      options: { redirectTo: AUTH_REDIRECT_URL, skipBrowserRedirect: true },
    });
    if (error || !data?.url) {
      return { status: 'error', message: error?.message ?? 'no_oauth_url' };
    }

    const res = await WebBrowser.openAuthSessionAsync(data.url, AUTH_REDIRECT_URL);
    if (res.type === 'cancel' || res.type === 'dismiss') return { status: 'cancelled' };
    if (res.type !== 'success') return { status: 'error', message: res.type };

    const { params, errorCode } = QueryParams.getQueryParams(res.url);
    if (errorCode) return { status: 'error', message: errorCode };
    const code = params.code;
    if (!code) {
      return { status: 'error', message: params.error_description ?? params.error ?? 'no_code' };
    }

    const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
    if (exErr) return { status: 'error', message: exErr.message };

    return { status: 'signed-in' };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'oauth_failed' };
  }
}
