import '../global.css';

import {
  HankenGrotesk_300Light,
  HankenGrotesk_400Regular,
  HankenGrotesk_400Regular_Italic,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
  HankenGrotesk_800ExtraBold,
} from '@expo-google-fonts/hanken-grotesk';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import * as Sentry from '@sentry/react-native';
import { isProfileComplete } from '@athanor/core';
import { semantic } from '@athanor/config';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { ToastProvider } from '@/components/ToastHost';
import { BrandSplash } from '@/components/boot/BrandSplash';
import { AppErrorScreen } from '@/components/boot/AppErrorScreen';
import { BootGate } from '@/components/boot/BootGate';
import { CrashTrailGate } from '@/components/boot/CrashTrailGate';
import { ProfileErrorScreen } from '@/components/boot/ProfileErrorScreen';
import { SentryConsentGate } from '@/components/boot/SentryConsentGate';
import { markStep } from '@/lib/crash-trail';
import { devWarn } from '@/lib/log';
import { asyncStoragePersister, queryClient, shouldDehydrateQuery } from '@/lib/query-client';
SplashScreen.preventAutoHideAsync();
// Settles a dangling OAuth browser session on resume (required for the web target;
// no-op on native). Must run at module load, not inside a component.
WebBrowser.maybeCompleteAuthSession();
// NOTE: Sentry is NOT initialized here. Init is deferred to SentryConsentGate (fires only
// once the user grants diagnostics consent) so no telemetry leaves the device before consent
// (B-5). Sentry.wrap and Sentry.ErrorBoundary below are both safe pre-init — they capture
// nothing until init runs.

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, profile, loading, flushing, profileError, refreshProfile, signOut } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    // Hold position during the initial session read and while the pre-auth
    // onboarding draft is being flushed (prevents a funnel flash post-OTP).
    if (loading || flushing) return;
    // auth-callback counts as auth: it is where the signup-confirmation deep link
    // lands, and it must be left mounted long enough to exchange its ?code (the
    // unauth branch below would otherwise bounce it straight to the funnel). Once
    // the exchange lands, the authed branches route it onward like any auth screen.
    const inAuth = segments[0] === '(auth)' || segments[0] === 'auth-callback';
    const inOnboarding = segments[0] === '(onboarding)';

    if (!session) {
      // Unauth: start in the onboarding funnel (prototype order — questions first).
      // The funnel's final step, and its «Accedi» link, route on to (auth)/welcome.
      if (!inAuth && !inOnboarding) router.replace('/(onboarding)');
      return;
    }
    if (!profile) return; // profile still hydrating

    if (isProfileComplete(profile)) {
      // Explicit group href: both (tabs)/index and (onboarding)/index resolve to '/',
      // and onboarding wins the bare path — so a bare replace('/') lands back on the
      // funnel (the loop). '/(tabs)' disambiguates to the Home tab.
      if (inAuth || inOnboarding) router.replace('/(tabs)');
    } else if (!inOnboarding) {
      // Authed but incomplete with no draft to flush (e.g. login on a new device).
      router.replace('/(onboarding)');
    }
  }, [loading, flushing, session, profile, segments, router]);

  if (loading) {
    return null;
  }
  // Signed in but the profile read broke. The routing effect above returns on a
  // null profile, so without this the user is stranded on the auth screen with
  // no error and no retry.
  if (session && profileError && !profile) {
    return (
      <ProfileErrorScreen onRetry={() => void refreshProfile()} onSignOut={() => void signOut()} />
    );
  }
  return <>{children}</>;
}

function RootLayout() {
  // One face per weight — RN selects fonts by exact family name, so each
  // font-{light..extrabold} utility maps to its own family (global.css).
  const [fontsLoaded, fontError] = useFonts({
    HankenGrotesk_300Light,
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
    HankenGrotesk_700Bold,
    HankenGrotesk_800ExtraBold,
    // Dream register only (DESIGN.md §4): dream quotes + ritual captions, never UI.
    HankenGrotesk_400Regular_Italic,
  });
  const [splashDone, setSplashDone] = useState(false);

  /**
   * Boot proceeds when the fonts have SETTLED, loaded or failed (#519).
   *
   * The error half used to be discarded, and in `expo-font@14.0.12` `useRuntimeFonts` sets
   * `loaded` only inside `.then()` — the `.catch()` sets `error` and nothing else: no retry, no
   * timer, no `finally`. So on a rejection `fontsLoaded` stayed false for the lifetime of the
   * component, the effect below never ran, `hideAsync` never fired, and the app sat on the
   * NATIVE SPLASH forever with no telemetry and no way out. `BrandSplash` and `BootGate` are
   * both mounted inside the tree that the `return null` guard returned before, so neither was
   * reachable, and `Sentry.ErrorBoundary` could not see it either: nothing throws during
   * render, the rejection is swallowed into unused state.
   *
   * ## Why the app proceeds instead of showing AppErrorScreen
   *
   * That screen draws exactly one affordance, a `crash.retry` button wired to `resetError`,
   * and `useFonts` has no reload — expo-font's own docblock says the fonts are not reloaded
   * when the map changes. So an error screen here would ship a dead «Riprova» on the one
   * screen a member reaches at their worst moment, which is the thing that component's
   * docblock argues against.
   *
   * What actually failed is a set of TTFs. RN falls back to the platform face per missing
   * family, so the app is fully usable, only off-brand — a bounded, cosmetic loss that clears
   * on the next launch, against a total one. Rule 4's dream register survives as a register:
   * `font-dream italic` still renders italic, in the system's italic rather than Hanken's.
   * Trading the whole app for the typeface is the worse deal.
   */
  const fontsSettled = fontsLoaded || !!fontError;

  useEffect(() => {
    if (!fontError) return;
    // Dev visibility only, and that is the whole of it: `devWarn`'s own contract is that there
    // is no capture helper here because Sentry's init is consent-gated (B-5) and would be a
    // no-op at this point in the boot anyway. A member sees the consequence rather than a
    // report — the app renders in the platform's faces.
    devWarn('[boot] fonts failed to load — continuing with system faces', fontError);
  }, [fontError]);

  useEffect(() => {
    if (!fontsSettled) return;
    // Awaited, per `markStep`'s contract: the marker has to be ON DISK before the native call it
    // marks, and `hideAsync` is that call. Fire-and-forget here would make `boot.fonts` a no-op in
    // exactly the case it exists for — a process that dies at the splash-hide boundary. The cost
    // is one bridge round-trip before the splash lifts, on a path that already awaited the fonts.
    //
    // Gated on SETTLED, not loaded: the splash has to lift on the error path too, or the
    // fallback render happens behind a splash that never rises — the same frozen screen, just
    // with a live tree underneath it. One call site either way, so `boot.fonts` keeps its
    // meaning ("the app got past the fonts") and #488's ordering contract holds on both exits.
    void (async () => {
      await markStep('boot.fonts');
      await SplashScreen.hideAsync();
    })();
  }, [fontsSettled]);

  if (!fontsSettled) {
    return null;
  }

  return (
    // Root inset context (#161). React Navigation mounts its own compat provider inside the
    // navigator, so this one exists for the trees OUTSIDE it (BrandSplash, ProfileErrorScreen)
    // and to kill the first-frame inset flash via initialWindowMetrics.
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AuthProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister: asyncStoragePersister,
            dehydrateOptions: { shouldDehydrateQuery },
          }}
        >
          <StatusBar style="light" />
          {/* Drives the Sentry egress gate from the user's diagnostics consent (no UI). */}
          <SentryConsentGate />
          {/* Reads back the previous run's durable step trail, marks this run's lifecycle (no UI). */}
          <CrashTrailGate />
          {/* Toast state lives above the router (#117); the pill renders inside the
            focused Screen's viewport — a root-level mount would sit under (modal)'s
            native modal layer. */}
          <ToastProvider>
            <BootGate>
              <AuthGuard>
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: semantic.background },
                  }}
                >
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="(auth)" />
                  <Stack.Screen name="(onboarding)" />
                  <Stack.Screen name="(modal)" options={{ presentation: 'modal' }} />
                </Stack>
              </AuthGuard>
            </BootGate>
          </ToastProvider>
          {/* Branded brand-beat over the native splash hand-off (prototype §9). */}
          {!splashDone ? <BrandSplash onDone={() => setSplashDone(true)} /> : null}
        </PersistQueryClientProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

/**
 * Two distinct things, and the comment that used to sit here conflated them (#452).
 *
 * `Sentry.wrap` is NOT an error boundary — verified in @sentry/react-native@7.2.0's `sdk.js`, it
 * composes TouchEventBoundary → ReactNativeProfiler → FeedbackWidgetProvider and catches nothing.
 * Its touch and navigation breadcrumbs are worth keeping, so it stays.
 *
 * `Sentry.ErrorBoundary` (re-exported from @sentry/react) is the real one: it turns a render fatal
 * into AppErrorScreen instead of a white screen, and reports it once Sentry is initialized. It
 * wraps RootLayout rather than living inside it, so a throw in RootLayout's own body — fonts,
 * providers — is caught too. `fallback` must be a stable component reference: the boundary renders
 * it with createElement, so an inline arrow would remount the fallback on every render.
 *
 * Both are safe before init: `captureException` with no client warns and returns.
 */
export default Sentry.wrap(function RootLayoutWithBoundary() {
  return (
    <Sentry.ErrorBoundary fallback={AppErrorScreen}>
      <RootLayout />
    </Sentry.ErrorBoundary>
  );
});
