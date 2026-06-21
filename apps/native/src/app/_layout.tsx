import '../global.css';

import {
  HankenGrotesk_400Regular,
  HankenGrotesk_400Regular_Italic,
  HankenGrotesk_600SemiBold,
} from '@expo-google-fonts/hanken-grotesk';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { isProfileComplete } from '@athanor/core';
import { semantic } from '@athanor/config';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { BrandSplash } from '@/components/BrandSplash';
import { BootGate } from '@/components/BootGate';
import { asyncStoragePersister, queryClient } from '@/lib/query-client';

SplashScreen.preventAutoHideAsync();
// Settles a dangling OAuth browser session on resume (required for the web target;
// no-op on native). Must run at module load, not inside a component.
WebBrowser.maybeCompleteAuthSession();

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, profile, loading, flushing } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    // Hold position during the initial session read and while the pre-auth
    // onboarding draft is being flushed (prevents a funnel flash post-OTP).
    if (loading || flushing) return;
    const inAuth = segments[0] === '(auth)';
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
  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    HankenGrotesk_400Regular,
    HankenGrotesk_600SemiBold,
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
    <AuthProvider>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister: asyncStoragePersister }}
      >
        <StatusBar style="light" />
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
        {/* Branded brand-beat over the native splash hand-off (prototype §9). */}
        {!splashDone ? <BrandSplash onDone={() => setSplashDone(true)} /> : null}
      </PersistQueryClientProvider>
    </AuthProvider>
  );
}
