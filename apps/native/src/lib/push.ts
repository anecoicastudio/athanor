import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { registerPushToken, unregisterPushToken } from '@athanor/api';
import { t } from '@athanor/i18n';
import { deviceLocale } from '@/lib/locale';
import { devWarn } from '@/lib/log';
import { type PermStatus, toPeekStatus, toStatus } from '@/lib/media/permission-status';
import { capturePushFailure, type PushFailureStage } from '@/lib/sentry';
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
 * The one Android notification channel (#746). Android shows a push only through a channel, and
 * none was declared, so FCM fell back to an unnamed «Miscellaneous» one. The id is `default`
 * because `push-dispatch` sends no `channelId`: Expo resolves an absent one to `default`, and
 * so does FCM through the plugin's `defaultChannel` in app.json — every push lands here.
 *
 * The name is member-facing (Android lists it under the app's notification settings) and uses
 * the DEVICE language, because that list is rendered by the system in the device language.
 * Re-sent on every call: Android lets an app rename an existing channel, so a language change
 * is picked up at the next launch, and nothing else about a channel can change once created.
 * HIGH importance is the Android counterpart of the banner iOS shows for a background push;
 * in the foreground the handler above still suppresses it.
 *
 * Best-effort: a push without our channel still arrives, in the fallback one, so a failure here
 * is reported and never blocks registration or the permission prompt.
 */
const ANDROID_CHANNEL = 'default';

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
      name: t('notif.channel.name', deviceLocale),
      description: t('notif.channel.description', deviceLocale),
      importance: Notifications.AndroidImportance.HIGH,
    });
  } catch (e) {
    devWarn('[push] channel', e);
    capturePushFailure('channel', e);
  }
}

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
  // Before the prompt: on Android 13+ the grant is per app, but a push that arrives between the
  // grant and the next registration pass still needs a channel to show in.
  await ensureAndroidChannel();
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
 *
 * A throw is still never allowed to crash auth, but it is no longer silent (#746): the catch
 * used to be a `__DEV__`-only warn, and a missing Firebase config made every Android boot throw
 * here while production showed zero tokens and zero errors. Each stage reports under its own
 * name, through the consent-held, message-free `capturePushFailure`.
 */
export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null; // simulators have no push token — not a failure
  await ensureAndroidChannel();

  let stage: PushFailureStage = 'permission';
  try {
    const { granted } = await Notifications.getPermissionsAsync();
    if (!granted) return null;

    stage = 'token';
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );

    stage = 'register';
    const platform = Platform.OS === 'android' ? 'android' : 'ios';
    await registerPushToken(supabase, { token, platform, deviceId: Device.osBuildId ?? null });
    return token;
  } catch (e) {
    devWarn(`[push] registration failed at ${stage}`, e);
    capturePushFailure(stage, e);
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
