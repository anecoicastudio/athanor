/**
 * Where `AuthGuard` (`src/app/_layout.tsx`) sends the member, as a pure decision: the route it
 * should `router.replace` to, or `null` to stay put. The guard keeps the two holds that are about
 * time rather than place (`loading`, `flushing`); everything about place lives here so it can be
 * tested from the node harness.
 */

export type AuthGuardTarget =
  | '/(onboarding)'
  | '/(onboarding)/handle'
  | '/(modal)/new-password'
  | '/(tabs)';

export interface AuthGuardInput {
  /** `useSegments()`. Empty until the navigator has reported its first state. */
  segments: readonly string[];
  signedIn: boolean;
  /** Recovery-link session latch (`auth-context`, #631). */
  recoveryPending: boolean;
  /** `nextOnboardingStep(profile)`, or `undefined` while the profile is still hydrating. */
  onboardingStep: 'funnel' | 'handle' | null | undefined;
}

export function authGuardRedirect({
  segments,
  signedIn,
  recoveryPending,
  onboardingStep,
}: AuthGuardInput): AuthGuardTarget | null {
  // Empty segments mean the navigator has not reported yet, never «the member is nowhere»:
  // every route in src/app sits in a group or under a named file, so a reported route has at
  // least one segment (the sibling test pins that there is no root index). Deciding here was
  // #905's signed-out half: on an Android cold start the guard first runs in the commit that
  // mounts the <Stack>, the store still holds its default route info, and the unauth branch
  // replaced the deep-linked route (a confirmation or recovery `auth-callback`) with the
  // funnel. expo-router@57.0.24, read 2026-10-01: `useStore` in `build/global-state/useStore.js`
  // seeds route info only from a synchronous initial URL, and `getInitialURLWithTimeout` in
  // `build/fork/useLinking.native.js` returns a Promise on Android. The effect re-runs when
  // the segments arrive, so holding costs one commit.
  if (segments.length === 0) return null;

  // auth-callback counts as auth: it is where the signup-confirmation deep link
  // lands, and it must be left mounted long enough to exchange its ?code (the
  // unauth branch below would otherwise bounce it straight to the funnel). Once
  // the exchange lands, the authed branches route it onward like any auth screen.
  const inAuth = segments[0] === '(auth)' || segments[0] === 'auth-callback';
  const inOnboarding = segments[0] === '(onboarding)';

  if (!signedIn) {
    // Unauth: start in the onboarding funnel (prototype order — questions first).
    // The funnel's final step, and its «Accedi» link, route on to (auth)/welcome.
    return inAuth || inOnboarding ? null : '/(onboarding)';
  }
  // Recovery-link session (#631): park the member on the new-password sheet before
  // any profile-based routing — the sheet needs no profile, and a slow hydrate must
  // not hold it hostage. Checked before the profile gate for exactly that reason.
  // The latch clears on save or skip (auth-context.clearRecovery); until then a
  // dismissed sheet is simply re-presented, which is what makes the auth-callback
  // race (guard routes before that screen's .then runs) harmless.
  if (recoveryPending) {
    return segments[0] === '(modal)' && segments[1] === 'new-password'
      ? null
      : '/(modal)/new-password';
  }
  if (onboardingStep === undefined) return null; // profile still hydrating

  const onHandleStep = inOnboarding && segments[1] === 'handle';
  if (onboardingStep === null) {
    // Explicit group href: both (tabs)/index and (onboarding)/index resolve to '/',
    // and onboarding wins the bare path — so a bare replace('/') lands back on the
    // funnel (the loop). '/(tabs)' disambiguates to the Home tab.
    return inAuth || inOnboarding ? '/(tabs)' : null;
  }
  if (onboardingStep === 'handle') {
    // #782: the answers landed and only the @handle is missing — chosen on its own screen
    // after sign-up, never derived from the email. Every sign-up path arrives here: email
    // and password, Google, and a first sign-in on a new device.
    return onHandleStep ? null : '/(onboarding)/handle';
  }
  // Authed but the funnel's answers are missing with no draft to flush (e.g. login on a
  // new device). The handle step is not the place for that: the answers come first.
  return !inOnboarding || onHandleStep ? '/(onboarding)' : null;
}
