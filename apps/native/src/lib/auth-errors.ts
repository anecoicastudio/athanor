import type { MessageKey } from '@athanor/i18n';

/**
 * Map a Supabase AuthError to a specific message so the cause is visible, instead
 * of a blanket "Something didn't work." signInWithPassword returns invalid_credentials
 * for both wrong password and unknown email (enumeration protection), so those collapse.
 */
export function authErrorKey(err: { code?: string; status?: number }): MessageKey {
  if (err.code === 'invalid_credentials') return 'auth.error.invalidCredentials';
  // GoTrue closes sign-in with the same code for a timed suspension, a permanent ban
  // (moderation-enforce sets ban_duration for both, #106/#312) and, since #733, a member's
  // own erasure request; its error carries no cause and no end date, so the copy names all
  // three without promising a return — the in-session SuspendedNotice is where a date renders.
  if (err.code === 'user_banned') return 'auth.error.suspended';
  if (err.code === 'user_already_exists' || err.code === 'email_exists')
    return 'auth.error.emailTaken';
  if (err.code === 'weak_password') return 'auth.error.weakPassword';
  if (err.code === 'email_address_invalid') return 'auth.error.invalidEmail';
  if (err.code === 'over_request_rate_limit' || err.status === 429) return 'auth.error.rateLimit';
  // auth-js wraps a transport failure (fetch threw, nothing reached GoTrue) in an
  // AuthRetryableFetchError with status 0 and no code — the one case where "try
  // again" should say the network is the reason.
  if (err.status === 0) return 'auth.error.network';
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
  // The callback carries `error_code=user_banned` (oauth.ts returns errorCode as the message)
  // or the description «User is banned». Same closed door as the password path (#733):
  // «try again» would be an invitation to retry forever.
  if (/user_banned|user is banned/i.test(message)) return 'auth.error.suspended';
  return 'auth.error.oauthFailed';
}
