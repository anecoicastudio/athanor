import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Expo Go is the runtime this file is about (#452). It used to be a hard no-op: the gate at
 * `initSentry` carried `isExpoGo` and nothing ever left a tester's device.
 *
 * It is not all-or-nothing in the SDK. `Sentry.init` does not bail in Expo Go — `enableNative`
 * resolves to `NATIVE.isNativeAvailable()`, `makeNativeTransportFactory` returns null without the
 * native module, and init falls through to `makeFetchTransport` (@sentry/react-native@7.2.0,
 * `dist/js/sdk.js` + `dist/js/transports/native.js`). JS errors and messages transmit; native
 * crash capture, offline caching, replay and expo context do not.
 *
 * Sibling of `sentry-init.test.ts`, which runs the same module as 'standalone'. The split is the
 * mock: `expo-constants` is per-file, so the two environments cannot share one.
 */
vi.mock('expo-constants', () => ({
  default: { executionEnvironment: 'storeClient' },
}));
vi.mock('@sentry/react-native', () => ({
  init: vi.fn(),
  close: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureMessage: vi.fn(),
}));

process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@sentry.example/1';

const Sentry = vi.mocked(await import('@sentry/react-native'));
const { captureTrail, closeSentry, initSentry } = await import('./sentry');

beforeEach(() => {
  vi.clearAllMocks();
  closeSentry(); // re-arm init between cases
});

describe('initSentry in Expo Go', () => {
  it('initializes, so a tester crash has somewhere to go', () => {
    initSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
  });

  it('tags the event with the runtime, so a triager knows what was NOT captured', () => {
    initSentry();
    const options = Sentry.init.mock.calls[0]?.[0] as { initialScope?: { tags?: unknown } };
    expect(options.initialScope?.tags).toEqual({ expo_go: true });
  });

  it('still refuses to init without a DSN', async () => {
    // The one half of the old gate that stays: no DSN, nowhere to send, no init.
    vi.resetModules();
    const previous = process.env.EXPO_PUBLIC_SENTRY_DSN;
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    try {
      const fresh = await import('./sentry');
      fresh.initSentry();
      expect(Sentry.init).not.toHaveBeenCalled();
    } finally {
      process.env.EXPO_PUBLIC_SENTRY_DSN = previous;
      vi.resetModules();
    }
  });
});

describe('captureTrail', () => {
  const steps = [
    { s: 'poster.player', t: 0 },
    { s: 'poster.thumbnails', t: 3500 },
  ] as const;

  it('sends nothing before init — a revoked consent leaves no path out', () => {
    captureTrail(steps);
    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('sends nothing for an empty trail', () => {
    initSentry();
    captureTrail([]);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('puts each step up as a breadcrumb, then one warning event', () => {
    initSentry();
    captureTrail(steps);

    // The top-level addBreadcrumb, deliberately: it is the call that runs `beforeBreadcrumb`,
    // which is where the consent gate and the redaction live. A scope's own addBreadcrumb
    // bypasses both.
    expect(Sentry.addBreadcrumb.mock.calls.map((c) => c[0]?.message)).toEqual([
      'poster.player +0ms',
      'poster.thumbnails +3500ms',
    ]);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage.mock.calls[0]?.[1]).toBe('warning');
  });

  it('carries step names and offsets only — never a payload', () => {
    initSentry();
    captureTrail(steps);

    for (const [crumb] of Sentry.addBreadcrumb.mock.calls) {
      expect(crumb?.message).toMatch(/^[a-z.]+ \+\d+ms$/);
      expect(crumb?.data).toBeUndefined();
    }
  });
});
