import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { type Database, resolveSupabaseKey } from '@athanor/api';

import { authStorage } from './session-storage';
import { markClientOutdated } from './outdated-client';
import { isVersionGateRejection, requestUrlOf } from './version-gate';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;

if (!url) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL');
}

// Metro INLINES `process.env.EXPO_PUBLIC_*` at bundle time, so both names must appear as
// literal member expressions here — a computed lookup silently yields undefined.
const anonKey = resolveSupabaseKey(
  {
    publishable: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    anon: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  },
  {
    publishable: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    anon: 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    hint:
      'Local runs read apps/native/.env; EAS cloud builds do NOT — they read EAS ' +
      'environment variables for the profile named in eas.json.',
  },
);

// Expo Router renders the route tree in Node (no `window`) for `web.output:"static"`.
// On that server pass AsyncStorage's web shim reads `window.localStorage` and throws,
// and react-native-web's AppState touches the DOM. `window` exists on both native and
// browser, so this only affects the server render — give it inert storage and skip the
// AppState listener there. Native/browser behaviour is unchanged.
const isServerRender = typeof window === 'undefined';

const noopStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

// Version-gate backstop (RELEASE-RUNBOOK §6.4): every request carries the build's
// version + platform; edge functions reject unsupported builds with 426. The fetch
// wrapper is the single interception point — on 426 it trips the sticky outdated
// flag (BootGate pins ForceUpdateScreen) and returns the response unchanged so
// per-call-site error handling still sees the failure. The 426 verdict itself lives
// in ./version-gate (pure, node-testable); the side effect stays here.
const versionHeaders = {
  'x-app-version': Constants.expoConfig?.version ?? '',
  'x-app-platform': Platform.OS,
};

const gatedFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (isVersionGateRejection(response, requestUrlOf(input))) markClientOutdated();
  return response;
};

// Session storage (P1.7): native uses the LargeSecureStore adapter (AES-256
// key in SecureStore, ciphertext in AsyncStorage — session JSON exceeds the
// 2 KB SecureStore limit); the web build keeps AsyncStorage. Legacy plaintext
// sessions are re-encrypted in place on first read.
export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    storage: isServerRender ? noopStorage : authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
  global: {
    headers: versionHeaders,
    fetch: gatedFetch,
  },
});

// RN has no document visibility: drive token auto-refresh from AppState.
if (!isServerRender) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
