import AsyncStorage from '@react-native-async-storage/async-storage';

// Web/default resolution (Metro picks session-storage.native.ts on iOS and
// Android): expo-secure-store has no browser implementation, so the web build
// keeps localStorage-backed AsyncStorage — unchanged pre-P1.7 behavior. The
// expo-router static server render never reaches this either way (supabase.ts
// hands it noopStorage), and this file is native-free so evaluating it in
// Node is safe.
export const authStorage = AsyncStorage;
