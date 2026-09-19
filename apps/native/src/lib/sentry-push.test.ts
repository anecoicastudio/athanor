import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #746: Android push registration threw on every boot and `push.ts` swallowed it behind a
 * dev-only warn, so production held zero Android tokens AND zero errors. `capturePushFailure`
 * is what makes that zero loud — without breaking either rule in sentry.ts's header:
 *
 *  - consent: registration runs on INITIAL_SESSION, before SentryConsentGate can init, so a
 *    failure raised then is held and sent only when init happens (i.e. only after consent);
 *  - PII: the error's own message is never sent. A PostgREST unique-violation names the row
 *    (`(profile_id, token)=(…)`), so only a fixed title and two bare tags leave the device.
 *
 * Fresh module per test: `initialized`, the held failure and the once-per-stage set are
 * module state, and each case needs its own launch.
 */
vi.mock('expo-constants', () => ({
  default: { executionEnvironment: 'standalone' },
}));
vi.mock('@sentry/react-native', () => ({
  init: vi.fn(),
  close: vi.fn(() => Promise.resolve(true)),
  captureMessage: vi.fn(),
}));

process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@sentry.example/1';

async function launch() {
  vi.resetModules();
  const Sentry = vi.mocked(await import('@sentry/react-native'));
  const sentry = await import('./sentry');
  return { Sentry, ...sentry };
}

const coded = (message: string, code: unknown) => Object.assign(new Error(message), { code });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('capturePushFailure (#746)', () => {
  it('holds a failure raised before consent and sends it when Sentry inits', async () => {
    const { Sentry, capturePushFailure, closeSentry, initSentry } = await launch();

    capturePushFailure(
      'token',
      coded('Default FirebaseApp is not initialized', 'E_REGISTRATION_FAILED'),
    );
    expect(Sentry.captureMessage).not.toHaveBeenCalled();

    initSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith('push: registration failed', {
      level: 'warning',
      tags: { push_stage: 'token', push_error_code: 'E_REGISTRATION_FAILED' },
    });

    // Sent once: a consent toggle is close + re-init (SentryConsentGate), and the re-init must
    // not replay what already left. Without the close, the second init returns early and this
    // would pass whether or not the held reports were cleared.
    closeSentry();
    initSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(2);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it('after init it sends at once — once per stage per launch', async () => {
    const { Sentry, capturePushFailure, initSentry } = await launch();
    initSentry();

    // TOKEN_REFRESHED retries registration roughly hourly while no token is held; one broken
    // device must not become one event an hour.
    capturePushFailure('token', coded('x', 'E_REGISTRATION_FAILED'));
    capturePushFailure('token', coded('x', 'E_REGISTRATION_FAILED'));
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);

    capturePushFailure('register', coded('y', '42501'));
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
    expect(Sentry.captureMessage).toHaveBeenLastCalledWith('push: registration failed', {
      level: 'warning',
      tags: { push_stage: 'register', push_error_code: '42501' },
    });
  });

  it('never carries the error message — a token or a row key can live there', async () => {
    const { Sentry, capturePushFailure, initSentry } = await launch();
    initSentry();

    capturePushFailure(
      'register',
      coded(
        'duplicate key value violates unique constraint: (profile_id, token)=(5f0c-uuid, ExponentPushToken[abc123])',
        '23505',
      ),
    );

    const sent = JSON.stringify(Sentry.captureMessage.mock.calls);
    expect(sent).not.toContain('ExponentPushToken');
    expect(sent).not.toContain('5f0c-uuid');
    expect(sent).not.toContain('duplicate key');
    expect(sent).toContain('23505');
  });

  it.each([
    ['a code carrying free text', coded('m', 'bad code with ExponentPushToken[abc]')],
    ['a non-string code', coded('m', 42)],
    ['an Error with no code', new Error('ExponentPushToken[abc]')],
    ['a thrown string', 'ExponentPushToken[abc]'],
    ['a thrown null', null],
  ])('reports %s as code "none"', async (_label, error) => {
    const { Sentry, capturePushFailure, initSentry } = await launch();
    initSentry();

    capturePushFailure('token', error);
    expect(Sentry.captureMessage).toHaveBeenCalledWith('push: registration failed', {
      level: 'warning',
      tags: { push_stage: 'token', push_error_code: 'none' },
    });
    expect(JSON.stringify(Sentry.captureMessage.mock.calls)).not.toContain('ExponentPushToken');
  });

  it('holds one failure per stage until init', async () => {
    const { Sentry, capturePushFailure, initSentry } = await launch();

    capturePushFailure('channel', coded('c', 'E_CHANNEL'));
    capturePushFailure('token', coded('t', 'E_REGISTRATION_FAILED'));
    capturePushFailure('token', coded('t2', 'E_OTHER'));
    initSentry();

    expect(Sentry.captureMessage.mock.calls.map(([, ctx]) => ctx)).toEqual([
      { level: 'warning', tags: { push_stage: 'channel', push_error_code: 'E_CHANNEL' } },
      { level: 'warning', tags: { push_stage: 'token', push_error_code: 'E_REGISTRATION_FAILED' } },
    ]);
  });
});
