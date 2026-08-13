import { describe, expect, it } from 'vitest';
import { t } from '@athanor/i18n';
import { authErrorKey, oauthErrorKey } from './auth-errors';

describe('authErrorKey', () => {
  it('invalid_credentials → one message for both wrong password and unknown email', () => {
    // Deliberate collapse: Supabase returns the same code for both so the form
    // cannot be used to enumerate which addresses have accounts.
    expect(authErrorKey({ code: 'invalid_credentials' })).toBe('auth.error.invalidCredentials');
  });

  it('both "already exists" codes collapse to emailTaken', () => {
    expect(authErrorKey({ code: 'user_already_exists' })).toBe('auth.error.emailTaken');
    expect(authErrorKey({ code: 'email_exists' })).toBe('auth.error.emailTaken');
  });

  it('weak_password → weakPassword', () => {
    expect(authErrorKey({ code: 'weak_password' })).toBe('auth.error.weakPassword');
  });

  it('email_address_invalid → invalidEmail', () => {
    expect(authErrorKey({ code: 'email_address_invalid' })).toBe('auth.error.invalidEmail');
  });

  it('rate limiting is caught by code OR by bare HTTP 429', () => {
    expect(authErrorKey({ code: 'over_request_rate_limit' })).toBe('auth.error.rateLimit');
    expect(authErrorKey({ status: 429 })).toBe('auth.error.rateLimit');
  });

  it('an unmapped code falls through to the generic message', () => {
    expect(authErrorKey({ code: 'session_not_found' })).toBe('auth.error.generic');
    expect(authErrorKey({})).toBe('auth.error.generic');
    expect(authErrorKey({ status: 500 })).toBe('auth.error.generic');
  });

  it('a transport failure (AuthRetryableFetchError, status 0) names the network', () => {
    // fetch threw before GoTrue answered: auth-js returns status 0 and no code.
    expect(authErrorKey({ status: 0 })).toBe('auth.error.network');
  });

  it('a recognised code wins over a 429 status', () => {
    expect(authErrorKey({ code: 'weak_password', status: 429 })).toBe('auth.error.weakPassword');
  });

  it('every branch resolves to real copy in both locales', () => {
    const errors = [
      { code: 'invalid_credentials' },
      { code: 'email_exists' },
      { code: 'weak_password' },
      { code: 'email_address_invalid' },
      { status: 429 },
      { status: 0 },
      {},
    ];
    for (const err of errors) {
      const key = authErrorKey(err);
      expect(t(key, 'it')).not.toBe(key);
      expect(t(key, 'en')).not.toBe(key);
    }
  });
});

describe('oauthErrorKey', () => {
  it('an unconfigured provider says so instead of "something went wrong"', () => {
    expect(oauthErrorKey('Unsupported provider: provider is not enabled')).toBe(
      'auth.error.providerDisabled',
    );
    expect(oauthErrorKey('provider is not enabled')).toBe('auth.error.providerDisabled');
  });

  it('the match is case-insensitive', () => {
    expect(oauthErrorKey('UNSUPPORTED PROVIDER')).toBe('auth.error.providerDisabled');
  });

  it('any other failure is a generic OAuth failure', () => {
    expect(oauthErrorKey('code exchange failed')).toBe('auth.error.oauthFailed');
    expect(oauthErrorKey('')).toBe('auth.error.oauthFailed');
  });

  it('both branches resolve to real copy in both locales', () => {
    for (const message of ['provider is not enabled', 'network down']) {
      const key = oauthErrorKey(message);
      expect(t(key, 'it')).not.toBe(key);
      expect(t(key, 'en')).not.toBe(key);
    }
  });
});
