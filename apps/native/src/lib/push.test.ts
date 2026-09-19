import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@athanor/i18n';
import { deviceLocale } from '@/lib/locale';

/**
 * #746 — Android push never registered, and nothing said so. Two halves are pinned here:
 *
 *  1. The notification channel. Android shows a push only through a channel, and none was
 *     declared anywhere, so FCM fell back to an unnamed «Miscellaneous» one. The id is
 *     `default` because `push-dispatch` sends no `channelId` and both Expo and the
 *     expo-notifications plugin's `defaultChannel` resolve an absent one to it; the name is
 *     member-facing (Android lists it in system settings), so it comes from the catalogs.
 *  2. The swallowed failure. Every stage that can throw now reports through
 *     `capturePushFailure` — which holds it until consent and strips it to a fixed title —
 *     instead of a dev-only warn that production never printed.
 *
 * `react-native` is mocked because this suite runs in `environment: 'node'` and RN ships
 * untranspiled Flow (calendar.test.ts precedent); `Platform.OS` is all push.ts reads.
 */
const h = vi.hoisted(() => ({
  os: 'android' as 'android' | 'ios',
  isDevice: true,
  perm: { granted: true, canAskAgain: true, status: 'granted' },
  calls: [] as string[],
  channelError: null as unknown,
  permissionError: null as unknown,
  tokenError: null as unknown,
  registerError: null as unknown,
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return h.os;
    },
  },
}));
vi.mock('expo-device', () => ({
  get isDevice() {
    return h.isDevice;
  },
  osBuildId: 'build-1',
}));
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { eas: { projectId: 'project-1' } } } },
}));
vi.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 5, HIGH: 6 },
  setNotificationHandler: vi.fn(),
  setNotificationChannelAsync: vi.fn(async (_id: string, channel: unknown) => {
    h.calls.push('channel');
    if (h.channelError) throw h.channelError;
    return channel;
  }),
  getPermissionsAsync: vi.fn(async () => {
    h.calls.push('permissions');
    if (h.permissionError) throw h.permissionError;
    return h.perm;
  }),
  requestPermissionsAsync: vi.fn(async () => {
    h.calls.push('request');
    return h.perm;
  }),
  getExpoPushTokenAsync: vi.fn(async () => {
    h.calls.push('token');
    if (h.tokenError) throw h.tokenError;
    return { data: 'ExponentPushToken[test]' };
  }),
}));
vi.mock('@athanor/api', () => ({
  registerPushToken: vi.fn(async () => {
    h.calls.push('register');
    if (h.registerError) throw h.registerError;
  }),
  unregisterPushToken: vi.fn(),
}));
vi.mock('./supabase', () => ({ supabase: {} }));
vi.mock('@/lib/sentry', () => ({ capturePushFailure: vi.fn() }));

const Notifications = vi.mocked(await import('expo-notifications'));
const api = vi.mocked(await import('@athanor/api'));
const { capturePushFailure } = vi.mocked(await import('@/lib/sentry'));
const { ensurePushPermission, registerForPush } = await import('./push');

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  h.os = 'android';
  h.isDevice = true;
  h.perm = { granted: true, canAskAgain: true, status: 'granted' };
  h.calls = [];
  h.channelError = null;
  h.permissionError = null;
  h.tokenError = null;
  h.registerError = null;
});

describe('the Android notification channel', () => {
  it('is created before the token is asked for, named from the catalogs', async () => {
    await expect(registerForPush()).resolves.toBe('ExponentPushToken[test]');

    expect(h.calls.indexOf('channel')).toBeGreaterThanOrEqual(0);
    expect(h.calls.indexOf('channel')).toBeLessThan(h.calls.indexOf('token'));
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('default', {
      name: t('notif.channel.name', deviceLocale),
      description: t('notif.channel.description', deviceLocale),
      importance: Notifications.AndroidImportance.HIGH,
    });
  });

  it('carries real copy in both languages, not a key and not «notifiche» boilerplate', () => {
    for (const locale of ['it', 'en'] as const) {
      for (const key of ['notif.channel.name', 'notif.channel.description'] as const) {
        const copy = t(key, locale);
        expect(copy, `${key} ${locale}`).not.toBe(key);
        expect(copy.toLowerCase(), `${key} ${locale}`).not.toMatch(/notific/);
      }
    }
  });

  it('exists even while permission is missing, so a later grant lands in it', async () => {
    h.perm = { granted: false, canAskAgain: true, status: 'undetermined' };

    await expect(registerForPush()).resolves.toBeNull();
    expect(h.calls).toEqual(['channel', 'permissions']);
    expect(capturePushFailure).not.toHaveBeenCalled();
  });

  it('is created before the OS prompt the primer fires', async () => {
    h.perm = { granted: false, canAskAgain: true, status: 'undetermined' };

    await ensurePushPermission();
    expect(h.calls).toEqual(['channel', 'permissions', 'request']);
  });

  it('never blocks registration when it fails — the push still lands, in a fallback channel', async () => {
    const error = Object.assign(new Error('channel refused'), { code: 'E_CHANNEL' });
    h.channelError = error;

    await expect(registerForPush()).resolves.toBe('ExponentPushToken[test]');
    expect(capturePushFailure).toHaveBeenCalledTimes(1);
    expect(capturePushFailure).toHaveBeenCalledWith('channel', error);
    expect(api.registerPushToken).toHaveBeenCalledTimes(1);

    // The primer path swallows it the same way: the prompt still fires.
    await expect(ensurePushPermission()).resolves.toBe('granted');
  });

  it('is not an iOS concept', async () => {
    h.os = 'ios';

    await expect(registerForPush()).resolves.toBe('ExponentPushToken[test]');
    await ensurePushPermission();
    expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
    expect(api.registerPushToken).toHaveBeenCalledWith(
      {},
      { token: 'ExponentPushToken[test]', platform: 'ios', deviceId: 'build-1' },
    );
  });
});

describe('registerForPush reports what it used to swallow', () => {
  it('registers an android row on success, reporting nothing', async () => {
    await registerForPush();

    expect(api.registerPushToken).toHaveBeenCalledWith(
      {},
      { token: 'ExponentPushToken[test]', platform: 'android', deviceId: 'build-1' },
    );
    expect(capturePushFailure).not.toHaveBeenCalled();
  });

  it.each([
    ['permission', 'permissionError'],
    ['token', 'tokenError'],
    ['register', 'registerError'],
  ] as const)('a throw at the %s stage returns null and is reported', async (stage, field) => {
    const error = new Error(`${stage} failed`);
    h[field] = error;

    await expect(registerForPush()).resolves.toBeNull();
    expect(capturePushFailure).toHaveBeenCalledTimes(1);
    expect(capturePushFailure).toHaveBeenCalledWith(stage, error);
  });

  it('a simulator is not a failure', async () => {
    h.isDevice = false;

    await expect(registerForPush()).resolves.toBeNull();
    expect(h.calls).toEqual([]);
    expect(capturePushFailure).not.toHaveBeenCalled();
  });
});
