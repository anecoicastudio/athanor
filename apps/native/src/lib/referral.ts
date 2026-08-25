import AsyncStorage from '@react-native-async-storage/async-storage';
import { redeemPendingReferral, type AthanorClient } from '@athanor/api';
import { devWarn } from '@/lib/log';

const KEY = 'athanor.pendingReferral';
const CODE_RE = /^[A-Z0-9]{6,12}$/;

// Nothing here ever rejects (#179). The stash is a nicety layered on the deep-link → signup
// flow: invite/[code].tsx awaits `setPendingReferral` before it can `router.replace`,
// welcome.tsx awaits `getPendingReferral()` mid-submit and clears on every path that ends in
// an existing account, and auth-context consumes it on the first authenticated boot. A
// storage failure in any of them must read as "no referral", dev-visible — never as a
// stranded spinner or a deep link that never hands off. Callers may `void` these the way they
// `void` a TanStack refetch.

/** Stash a referral code across the deep-link → signup gap (survives restarts). */
export async function setPendingReferral(code: string): Promise<void> {
  const clean = code.trim().toUpperCase();
  if (!CODE_RE.test(clean)) return; // junk never persists
  try {
    await AsyncStorage.setItem(KEY, clean);
  } catch (e) {
    devWarn('[referral] set', e);
  }
}

export async function getPendingReferral(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch (e) {
    devWarn('[referral] get', e);
    return null;
  }
}

export async function clearPendingReferral(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch (e) {
    devWarn('[referral] clear', e);
  }
}

/**
 * Redeem the stash for the member who just authenticated, then drop it (#78).
 *
 * This is the OAuth path's only redemption: Google and Apple carry no user_metadata, so
 * `athanor.redeem_referral` — which reads the code out of exactly that — can never see it
 * from a trigger. The email paths have already redeemed server-side by the time this runs and
 * the RPC no-ops on them, so it stays provider-blind rather than asking who signed in.
 *
 * Consuming here is also what stops a stale code mis-attributing a later signup on the same
 * device: the stash is dropped the moment the server has ruled on it, whether it redeemed or
 * refused. A rejected call is the one case that keeps it — no verdict was given, so the next
 * boot tries again, and the RPC's own age gate bounds how long that can matter.
 */
export async function consumePendingReferral(client: AthanorClient): Promise<void> {
  const code = await getPendingReferral();
  if (!code) return;
  try {
    await redeemPendingReferral(client, code);
  } catch (e) {
    devWarn('[referral] redeem', e);
    return;
  }
  await clearPendingReferral();
}
