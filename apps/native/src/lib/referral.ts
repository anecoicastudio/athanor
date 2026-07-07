import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'athanor.pendingReferral';
const CODE_RE = /^[A-Z0-9]{6,12}$/;

/** Stash a referral code across the deep-link → signup gap (survives restarts). */
export async function setPendingReferral(code: string): Promise<void> {
  const clean = code.trim().toUpperCase();
  if (!CODE_RE.test(clean)) return; // junk never persists
  await AsyncStorage.setItem(KEY, clean);
}

export async function getPendingReferral(): Promise<string | null> {
  return AsyncStorage.getItem(KEY);
}

export async function clearPendingReferral(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
