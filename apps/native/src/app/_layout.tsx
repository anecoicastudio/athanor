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
import { BootGate } from '@/components/boot/BootGate';
import { ProfileErrorScreen } from '@/components/boot/ProfileErrorScreen';
import { SentryConsentGate } from '@/components/boot/SentryConsentGate';
import { asyncStoragePersister, queryClient, shouldDehydrateQuery } from '@/lib/query-client';
import { supabase } from '@/lib/supabase';

SplashScreen.preventAutoHideAsync();
// Settles a dangling OAuth browser session on resume (required for the web target;
// no-op on native). Must run at module load, not inside a component.
WebBrowser.maybeCompleteAuthSession();
// NOTE: Sentry is NOT initialized here. Init is deferred to SentryConsentGate (fires only
// once the user grants diagnostics consent) so no telemetry leaves the device before consent
// (B-5). Sentry.wrap below is safe pre-init — it just captures nothing until init runs.

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, profile, loading, flushing, profileError, refreshProfile } = useAuth();
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
      <ProfileErrorScreen
        onRetry={() => void refreshProfile()}
        onSignOut={() => void supabase.auth.signOut()}
      />
    );
  }
  return <>{children}</>;
}

function RootLayout() {
  // One face per weight — RN selects fonts by exact family name, so each
  // font-{light..extrabold} utility maps to its own family (global.css).
  const [fontsLoaded] = useFonts({
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

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
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

// Sentry.wrap adds the crash-reporting error boundary + touch/navigation breadcrumbs.
// Harmless when init no-oped (Expo Go / no DSN); events only flow once consent is granted.
export default Sentry.wrap(RootLayout);
