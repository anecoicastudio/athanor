import { describe, expect, it } from 'vitest';
import { deriveVerifyState } from './state';

describe('deriveVerifyState', () => {
  it('is idle for a fresh user with no session', () => {
    expect(deriveVerifyState({ identityVerified: false, latestStatus: null })).toBe('idle');
  });

  it('is verified when the profile flag is set (flag wins over a stale failed row)', () => {
    expect(deriveVerifyState({ identityVerified: true, latestStatus: 'failed' })).toBe('verified');
  });

  it('is verified when the latest session verified before the profile flip landed', () => {
    expect(deriveVerifyState({ identityVerified: false, latestStatus: 'verified' })).toBe(
      'verified',
    );
  });

  it('is pending while a freshly-started session polls', () => {
    expect(
      deriveVerifyState({ identityVerified: false, latestStatus: null, sessionPending: true }),
    ).toBe('pending');
  });

  it('is pending when the latest session row is pending', () => {
    expect(deriveVerifyState({ identityVerified: false, latestStatus: 'pending' })).toBe('pending');
  });

  it('is failed when the latest session failed and nothing newer is pending', () => {
    expect(deriveVerifyState({ identityVerified: false, latestStatus: 'failed' })).toBe('failed');
  });

  it('prefers pending over failed when a retry session is in flight', () => {
    expect(
      deriveVerifyState({ identityVerified: false, latestStatus: 'failed', sessionPending: true }),
    ).toBe('pending');
  });
});
