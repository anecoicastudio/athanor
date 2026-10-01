import AsyncStorage from '@react-native-async-storage/async-storage';
import { devWarn } from '@/lib/log';

/**
 * The email a password reset was last requested for, on this device (#863).
 *
 * GoTrue keeps the PKCE flow state behind a recovery link for 300 s from the REQUEST (see
 * FLOW_STATE_LIFETIME_MS in lib/oauth.ts — a floor the hosted project cannot raise), while the
 * mail can arrive later than that. A dead link lands on auth-callback with nothing but a `code`
 * or a GoTrue `?error=`: no email, and no word on whether it was a recovery or a signup
 * confirmation, which share the route. This stash is what lets that screen offer a one-tap
 * resend instead of sending the member back to type it all again.
 *
 * Written only when resetPasswordForEmail succeeds; dropped on a successful exchange, on
 * sign-out, and on the first read past the window — which AuthProvider forces at every app
 * start, so a link never opened does not leave the address on disk for good. The window is the
 * mail link's own lifetime (mailer_otp_exp, an hour), not the flow state's: someone opening a
 * 20-minute-old mail is
 * exactly who the resend is for. Nothing here rejects — like lib/referral.ts, a storage failure
 * reads as "no marker", and auth-callback then shows the marker-less copy it always had.
 */
const KEY = 'athanor.recoveryRequest';
export const RECOVERY_REQUEST_TTL_MS = 60 * 60_000;

export async function rememberRecoveryRequest(
  email: string,
  now: () => number = Date.now,
): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ email: email.trim(), at: now() }));
  } catch (e) {
    devWarn('[recovery] set', e);
  }
}

export async function readRecoveryRequest(now: () => number = Date.now): Promise<string | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(KEY);
  } catch (e) {
    devWarn('[recovery] get', e);
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const email =
    parsed && typeof parsed === 'object' && 'email' in parsed ? parsed.email : undefined;
  const at = parsed && typeof parsed === 'object' && 'at' in parsed ? parsed.at : undefined;
  const age = typeof at === 'number' ? now() - at : NaN;
  if (typeof email !== 'string' || !email || !(age >= 0 && age <= RECOVERY_REQUEST_TTL_MS)) {
    await clearRecoveryRequest();
    return null;
  }
  return email;
}

export async function clearRecoveryRequest(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch (e) {
    devWarn('[recovery] clear', e);
  }
}
