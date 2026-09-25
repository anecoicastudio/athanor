import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { createURL } from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { Provider } from '@supabase/supabase-js';
import { supabase } from './supabase';

/**
 * Browser-based OAuth (the only Expo-Go-compatible path — native sign-in modules
 * need a dev build, which the Expo Go setup deliberately avoids). PKCE flow:
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

// Must match an entry in Supabase → Auth → Additional Redirect URLs, and matching there is
// exact. In a standalone build createURL resolves to `athanor:///auth-callback` — THREE
// slashes, not two: it builds `<scheme>://<host><path>`, the standalone host is empty, and
// expo-linking's `ensureLeadingSlash('', true)` turns that empty host into `/`
// (expo-linking 8.0.12, build/createURL.js:35-44; template at :111-113). In Expo Go it
// resolves to `exp://…/--/auth-callback`. The allow-lists on both hosted projects carry the
// two-slash `athanor://auth-callback` as well, because that is the form the docs and every
// dashboard entry use, and GoTrue does no URL normalisation before matching — the two forms
// never reconcile, so whichever one is missing is simply a miss.
//
// Exported because the email signup in (auth)/welcome.tsx passes the same value as
// emailRedirectTo — without it the confirmation mail falls back to the project's
// Site URL, which points at the website, not at the app. OAuth normally never routes
// to src/app/auth-callback.tsx — openAuthSessionAsync intercepts the redirect below
// and exchanges the code here — whereas the email link always does, arriving as a
// real OS deep link. "Normally": if the OS ever hands an OAuth redirect to the app as
// a deep link instead, both call sites would exchange the same code and the loser
// would surface a spurious error. Dormant for Apple, live for Google.
export const AUTH_REDIRECT_URL = createURL('/auth-callback');

// GoTrue keeps an OAuth flow state for 300 s: `defaultFlowStateExpiryDuration` in supabase/auth
// internal/conf/configuration.go, which is also a floor — a shorter configured value is raised to
// it — and the hosted Management API `config/auth` does not expose the setting at all. A provider
// callback that lands later cannot recover `redirect_to`, so GoTrue sends the sheet to `site_url`
// (the marketing homepage) with `error_code=bad_oauth_state`, and the member's only way back is
// the sheet's ✕ — which reads as `cancel`/`dismiss`, exactly like changing their mind (#855).
// The clock tells them apart: the sheet opens before `/authorize` runs, so a stranded sheet has
// always been open at least this long. A deliberate ✕ that late is told the same thing, and it is
// just as true for them — that flow state is dead and the next attempt starts a new one.
export const FLOW_STATE_LIFETIME_MS = 300_000;

export async function signInWithProvider(
  provider: 'apple' | 'google',
  now: () => number = Date.now,
): Promise<OAuthOutcome> {
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: provider as Provider,
      options: { redirectTo: AUTH_REDIRECT_URL, skipBrowserRedirect: true },
    });
    if (error || !data?.url) {
      return { status: 'error', message: error?.message ?? 'no_oauth_url' };
    }

    const openedAt = now();
    const res = await WebBrowser.openAuthSessionAsync(data.url, AUTH_REDIRECT_URL);
    if (res.type === 'cancel' || res.type === 'dismiss') {
      if (now() - openedAt >= FLOW_STATE_LIFETIME_MS) {
        return { status: 'error', message: 'oauth_state_expired' };
      }
      return { status: 'cancelled' };
    }
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
