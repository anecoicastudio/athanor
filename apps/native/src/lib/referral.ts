import AsyncStorage from '@react-native-async-storage/async-storage';
import { devWarn } from '@/lib/log';

const KEY = 'athanor.pendingReferral';
const CODE_RE = /^[A-Z0-9]{6,12}$/;

// Nothing here ever rejects (#179). The stash is a nicety layered on the deep-link → signup
// flow: welcome.tsx fires `void clearPendingReferral()` on both auth paths and awaits
// `getPendingReferral()` mid-submit, and invite/[code].tsx awaits `setPendingReferral` before
// it can `router.replace`. A storage failure there must read as "no referral", dev-visible —
// never as a stranded spinner or a deep link that never hands off. Callers may `void` these
// the way they `void` a TanStack refetch.

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
