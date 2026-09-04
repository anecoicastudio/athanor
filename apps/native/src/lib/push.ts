import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { registerPushToken, unregisterPushToken } from '@athanor/api';
import { devWarn } from '@/lib/log';
import { type PermStatus, toPeekStatus, toStatus } from '@/lib/media/permission-status';
import { supabase } from './supabase';

// Foreground arrivals do NOT show an OS banner — the in-app surface (✦ pip) updates instead
// (rule #3, no numeric badge; 09 §2.5). Background banners are handled by the OS.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Current notification-permission status WITHOUT prompting — seeds the primer (#561). */
export async function peekPushPermission(): Promise<PermStatus> {
  return toPeekStatus(await Notifications.getPermissionsAsync());
}

/**
 * Resolve the notification permission. Reads the current status first; only fires the OS
 * prompt while it can still show (`canAskAgain`) — the same read-then-request-once shape as
 * `ensureCameraPermission`. Two callers, and both are intent gestures rather than cold asks:
 * PushPrimer primes before calling it (#561), and the notification-preferences screen calls it
 * when a member switches a notification ON while the OS permission is missing (#637) — the
 * switch itself is the priming there. iOS grants exactly ONE ask per install, so a third caller
 * needs the same justification before it lands.
 */
export async function ensurePushPermission(): Promise<PermStatus> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return 'granted';
  if (current.canAskAgain) {
    return toStatus(await Notifications.requestPermissionsAsync());
  }
  return 'blocked';
}

/**
 * Acquire the Expo push token and register it. NEVER prompts (#561): the cold
 * `requestPermissionsAsync` this made on every signed-in boot was the fourth
 * canAskAgain-blind site — it burned the one iOS ask unprimed, and read only `.status`, so
 * denied and blocked collapsed. The ask lives with PushPrimer (`ensurePushPermission`); this
 * registers only when the grant already exists, and degrades to a logged no-op when it can't
 * (Expo Go since SDK 53, simulator, permission absent) — returns the token on success, else
 * null.
 */
export async function registerForPush(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null; // simulators have no push token
    const { granted } = await Notifications.getPermissionsAsync();
    if (!granted) return null;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const platform = Platform.OS === 'android' ? 'android' : 'ios';
    await registerPushToken(supabase, { token, platform, deviceId: Device.osBuildId ?? null });
    return token;
  } catch (e) {
    // Expo Go (SDK 53+) can't issue a remote token; never crash auth over it.
    if (__DEV__) console.warn('[push] registration skipped:', e);
    return null;
  }
}

export async function unregisterPush(token: string | null): Promise<void> {
  if (!token) return;
  try {
    await unregisterPushToken(supabase, token);
  } catch (e) {
    devWarn('[push] unregister', e);
    // best-effort — a stale token is also pruned server-side on a DeviceNotRegistered receipt
  }
}
