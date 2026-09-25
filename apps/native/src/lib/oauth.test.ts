import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #855: GoTrue keeps an OAuth flow state for 300 s. A provider callback that lands after that
 * cannot recover `redirect_to`, so GoTrue sends the auth sheet to `site_url` (the marketing
 * homepage) and the member's only way out is the sheet's ✕. That ✕ returns `cancel`/`dismiss`,
 * indistinguishable from a deliberate cancel — except by the clock: a stranded sheet has been
 * open longer than the state lives, because the sheet opens before `/authorize` runs.
 */
const browser = vi.hoisted(() => ({
  result: { type: 'dismiss' } as { type: string; url?: string },
  onOpen: () => {},
}));
const exchanged = vi.hoisted(() => ({ codes: [] as string[] }));

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      signInWithOAuth: async () => ({
        data: { url: 'https://example.supabase.co/auth/v1/authorize' },
        error: null,
      }),
      exchangeCodeForSession: async (code: string) => {
        exchanged.codes.push(code);
        return { error: null };
      },
    },
  },
}));
vi.mock('expo-linking', () => ({ createURL: () => 'athanor:///auth-callback' }));
vi.mock('expo-web-browser', () => ({
  openAuthSessionAsync: async () => {
    browser.onOpen();
    return browser.result;
  },
}));

import { FLOW_STATE_LIFETIME_MS, signInWithProvider } from './oauth';

/** A clock the browser advances by `openFor` ms while the sheet is up. */
function clockWithSheetOpenFor(openFor: number) {
  let t = 1_000_000;
  browser.onOpen = () => {
    t += openFor;
  };
  return () => t;
}

beforeEach(() => {
  browser.result = { type: 'dismiss' };
  browser.onOpen = () => {};
  exchanged.codes = [];
});

describe('signInWithProvider', () => {
  it('the flow-state lifetime is GoTrue’s 300 s floor', () => {
    expect(FLOW_STATE_LIFETIME_MS).toBe(300_000);
  });

  it('a quick ✕ is a deliberate cancel and stays silent', async () => {
    for (const type of ['cancel', 'dismiss']) {
      browser.result = { type };
      const now = clockWithSheetOpenFor(20_000);
      await expect(signInWithProvider('google', now)).resolves.toEqual({ status: 'cancelled' });
    }
  });

  it('a ✕ one millisecond short of the lifetime is still a cancel', async () => {
    const now = clockWithSheetOpenFor(FLOW_STATE_LIFETIME_MS - 1);
    await expect(signInWithProvider('apple', now)).resolves.toEqual({ status: 'cancelled' });
  });

  it('a ✕ at or past the lifetime is an expired sign-in, never a silent return (#855)', async () => {
    for (const type of ['cancel', 'dismiss']) {
      browser.result = { type };
      for (const openFor of [FLOW_STATE_LIFETIME_MS, 6 * 60_000 + 19_000]) {
        const now = clockWithSheetOpenFor(openFor);
        await expect(signInWithProvider('apple', now)).resolves.toEqual({
          status: 'error',
          message: 'oauth_state_expired',
        });
      }
    }
  });

  it('a slow sign-in that still comes back with a code signs in', async () => {
    browser.result = { type: 'success', url: 'athanor:///auth-callback?code=abc' };
    const now = clockWithSheetOpenFor(FLOW_STATE_LIFETIME_MS * 2);
    await expect(signInWithProvider('google', now)).resolves.toEqual({ status: 'signed-in' });
    expect(exchanged.codes).toEqual(['abc']);
  });

  it('an error handed back to the app carries GoTrue’s description', async () => {
    browser.result = {
      type: 'success',
      url: 'athanor:///auth-callback?error=invalid_request&error_code=bad_oauth_state&error_description=OAuth+state+has+expired',
    };
    await expect(signInWithProvider('google', clockWithSheetOpenFor(1))).resolves.toEqual({
      status: 'error',
      message: 'OAuth state has expired',
    });
  });
});
