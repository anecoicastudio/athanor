import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { registerPushToken, unregisterPushToken } from '@athanor/api';
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

/**
 * Acquire the Expo push token and register it. Degrades to a logged no-op when it can't
 * (Expo Go since SDK 53, simulator, denied permission) — returns the token on success, else null.
 */
export async function registerForPush(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null; // simulators have no push token
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return null;

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
  } catch {
    // best-effort — a stale token is also pruned server-side on a DeviceNotRegistered receipt
  }
}
