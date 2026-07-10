// MUST stay the first import: polyfills crypto.getRandomValues on Hermes
// before the AES key generation below AND before auth-js generates PKCE
// code-verifiers (upgrading it from its Math.random fallback).
import 'react-native-get-random-values';

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { createLargeSecureStore } from './large-secure-store';

// SecureStore keychainAccessible stays the default (WHEN_UNLOCKED): the
// AppState listener in supabase.ts stops token auto-refresh when the app is
// backgrounded, so nothing reads the key while the device is locked.
export const authStorage = createLargeSecureStore({
  secureStore: SecureStore,
  asyncStorage: AsyncStorage,
});
