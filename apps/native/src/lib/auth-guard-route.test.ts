import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { authGuardRedirect, type AuthGuardInput } from './auth-guard-route';

const input = (over: Partial<AuthGuardInput>): AuthGuardInput => ({
  segments: ['(tabs)'],
  signedIn: false,
  recoveryPending: false,
  onboardingStep: undefined,
  ...over,
});

describe('authGuardRedirect — navigator not reported yet (#905)', () => {
  // The regression: on an Android cold start the guard's first run sees `segments: []`, and the
  // signed-out branch used to replace the deep-link route with the funnel.
  it('holds when signed out and the segments are still empty', () => {
    expect(authGuardRedirect(input({ segments: [] }))).toBeNull();
  });

  it('holds on empty segments in every signed-in state too', () => {
    for (const onboardingStep of [undefined, null, 'handle', 'funnel'] as const) {
      expect(authGuardRedirect(input({ segments: [], signedIn: true, onboardingStep }))).toBeNull();
    }
    expect(
      authGuardRedirect(input({ segments: [], signedIn: true, recoveryPending: true })),
    ).toBeNull();
  });

  it('rests on no route resolving to empty segments: src/app has no root index', () => {
    const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
    const rootIndex = readdirSync(appDir).filter((name) => /^index\.[tj]sx?$/.test(name));
    expect(rootIndex).toEqual([]);
  });
});

describe('authGuardRedirect — signed out', () => {
  it('sends any app route to the funnel', () => {
    expect(authGuardRedirect(input({ segments: ['(tabs)'] }))).toBe('/(onboarding)');
    expect(authGuardRedirect(input({ segments: ['(modal)', 'help'] }))).toBe('/(onboarding)');
  });

  it('leaves the auth screens, the auth callback and the funnel alone', () => {
    expect(authGuardRedirect(input({ segments: ['(auth)', 'welcome'] }))).toBeNull();
    expect(authGuardRedirect(input({ segments: ['auth-callback'] }))).toBeNull();
    expect(authGuardRedirect(input({ segments: ['(onboarding)'] }))).toBeNull();
  });
});

describe('authGuardRedirect — recovery session (#631)', () => {
  const recovery = (segments: string[]) =>
    authGuardRedirect(input({ segments, signedIn: true, recoveryPending: true }));

  it('parks on the new-password sheet before any profile-based routing', () => {
    expect(recovery(['auth-callback'])).toBe('/(modal)/new-password');
    expect(recovery(['(tabs)'])).toBe('/(modal)/new-password');
    expect(recovery(['(modal)', 'help'])).toBe('/(modal)/new-password');
  });

  it('stays once the sheet is up', () => {
    expect(recovery(['(modal)', 'new-password'])).toBeNull();
  });
});

describe('authGuardRedirect — signed in', () => {
  const authed = (segments: string[], onboardingStep: AuthGuardInput['onboardingStep']) =>
    authGuardRedirect(input({ segments, signedIn: true, onboardingStep }));

  it('holds while the profile is still hydrating', () => {
    expect(authed(['(auth)', 'welcome'], undefined)).toBeNull();
  });

  it('complete profile: leaves auth, callback and funnel for the tabs, and nothing else', () => {
    expect(authed(['(auth)', 'welcome'], null)).toBe('/(tabs)');
    expect(authed(['auth-callback'], null)).toBe('/(tabs)');
    expect(authed(['(onboarding)'], null)).toBe('/(tabs)');
    expect(authed(['(tabs)'], null)).toBeNull();
    expect(authed(['(modal)', 'help'], null)).toBeNull();
  });

  it('handle missing (#782): routes to the handle step unless already there', () => {
    expect(authed(['(tabs)'], 'handle')).toBe('/(onboarding)/handle');
    expect(authed(['(onboarding)'], 'handle')).toBe('/(onboarding)/handle');
    expect(authed(['(onboarding)', 'handle'], 'handle')).toBeNull();
  });

  it('answers missing: routes to the funnel, and off the handle step', () => {
    expect(authed(['(tabs)'], 'funnel')).toBe('/(onboarding)');
    expect(authed(['(onboarding)', 'handle'], 'funnel')).toBe('/(onboarding)');
    expect(authed(['(onboarding)'], 'funnel')).toBeNull();
    expect(authed(['(onboarding)', 'dream'], 'funnel')).toBeNull();
  });
});
