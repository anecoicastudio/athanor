import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import type { Database } from '@athanor/api';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY');
}

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

// AsyncStorage keeps the refresh token in plaintext — accepted MVP tradeoff
// (Supabase RN quickstart default). Revisit with SecureStore LargeSecureStore
// wrapper before store release.
export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    storage: isServerRender ? noopStorage : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
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
