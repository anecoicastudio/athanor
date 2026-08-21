import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Breadcrumb, ErrorEvent } from '@sentry/react-native';

// Unlike sentry-scrub.test.ts this file runs OUTSIDE Expo Go ('standalone') with a DSN set,
// so initSentry actually reaches Sentry.init and we can capture the beforeSend /
// beforeBreadcrumb hooks it installs — the consent gate lives in those (RUNBOOK §3.5.1).
vi.mock('expo-constants', () => ({
  default: { executionEnvironment: 'standalone' },
}));
vi.mock('@sentry/react-native', () => ({
  init: vi.fn(),
  close: vi.fn(() => Promise.resolve(true)),
}));

process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@sentry.example/1';

const Sentry = vi.mocked(await import('@sentry/react-native'));
const { closeSentry, initSentry, setTelemetryConsent } = await import('./sentry');

type InitOptions = {
  sendDefaultPii: boolean;
  beforeSend: (event: ErrorEvent) => ErrorEvent | null;
  beforeBreadcrumb: (crumb: Breadcrumb) => Breadcrumb | null;
};

const initOptions = (): InitOptions => {
  initSentry();
  return Sentry.init.mock.calls[0]?.[0] as unknown as InitOptions;
};

beforeEach(() => {
  setTelemetryConsent(false);
});

describe('initSentry / closeSentry lifecycle', () => {
  it('inits once with PII off, and only re-inits after a close', () => {
    initSentry();
    initSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect((Sentry.init.mock.calls[0]?.[0] as { sendDefaultPii?: boolean }).sendDefaultPii).toBe(
      false,
    );

    // close() tears down and re-arms init; a second close without init is a no-op.
    closeSentry();
    expect(Sentry.close).toHaveBeenCalledTimes(1);
    closeSentry();
    expect(Sentry.close).toHaveBeenCalledTimes(1);
    initSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(2);
  });

  // #179: `void Sentry.close()` let a failed flush surface as an unhandled rejection on logout /
  // consent revoke. Vitest fails the run on an unhandled rejection, so the red state of this
  // test is the run itself going red, not an assertion.
  it('a rejected close() is dev-logged, never an unhandled rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    initSentry();
    Sentry.close.mockRejectedValueOnce(new Error('flush failed'));
    closeSentry();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[sentry] close', expect.any(Error)));
    warn.mockRestore();
  });
});

describe('consent gate in the installed hooks', () => {
  it('beforeSend drops every event until consent is granted, then scrubs', () => {
    const { beforeSend } = initOptions();
    const event = { user: { id: 'u1' }, extra: { chat: 'x' } } as unknown as ErrorEvent;
    expect(beforeSend(event)).toBeNull();

    setTelemetryConsent(true);
    const sent = beforeSend(event);
    expect(sent).toBe(event);
    expect(sent?.user).toBeUndefined();
    expect(sent?.extra).toBeUndefined();
  });

  it('beforeBreadcrumb drops crumbs pre-consent and console crumbs always', () => {
    const { beforeBreadcrumb } = initOptions();
    expect(beforeBreadcrumb({ category: 'navigation', message: 'route' })).toBeNull();

    setTelemetryConsent(true);
    // Console logs echo chat/profile text — dropped even with consent.
    expect(beforeBreadcrumb({ category: 'console', message: 'chat text' })).toBeNull();
  });

  it('beforeBreadcrumb keeps only method + status on network crumbs, drops other data', () => {
    const { beforeBreadcrumb } = initOptions();
    setTelemetryConsent(true);

    const http = beforeBreadcrumb({
      category: 'http',
      data: { method: 'GET', status_code: 500, url: 'https://x/rest?token=secret' },
    });
    expect(http?.data).toEqual({ method: 'GET', status_code: 500 });

    const ui = beforeBreadcrumb({ category: 'ui.click', data: { label: 'Send message' } });
    expect(ui?.data).toBeUndefined();
  });
});
