import type { MessageKey } from '@athanor/i18n';

/**
 * Map a Supabase AuthError to a specific message so the cause is visible, instead
 * of a blanket "Something didn't work." signInWithPassword returns invalid_credentials
 * for both wrong password and unknown email (enumeration protection), so those collapse.
 */
export function authErrorKey(err: { code?: string; status?: number }): MessageKey {
  if (err.code === 'invalid_credentials') return 'auth.error.invalidCredentials';
  if (err.code === 'user_already_exists' || err.code === 'email_exists')
    return 'auth.error.emailTaken';
  if (err.code === 'weak_password') return 'auth.error.weakPassword';
  if (err.code === 'email_address_invalid') return 'auth.error.invalidEmail';
  if (err.code === 'over_request_rate_limit' || err.status === 429) return 'auth.error.rateLimit';
  return 'auth.error.generic';
}

/**
 * signInWithProvider already carries the real reason (provider error, exchange
 * failure, missing code) — it used to be dropped into a dev warn, which is how
 * "Unsupported provider: provider is not enabled" stayed invisible while the
 * user read "Something didn't work."
 */
export function oauthErrorKey(message: string): MessageKey {
  if (/provider is not enabled|unsupported provider/i.test(message))
    return 'auth.error.providerDisabled';
  return 'auth.error.oauthFailed';
}
