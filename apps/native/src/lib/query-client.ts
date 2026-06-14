import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';

/**
 * Shared TanStack Query client. staleTime keeps the feed warm across tab
 * switches (SWR feel); gcTime bounds the persisted cache. Introduced at M3
 * (the "Foundation" prior slices deferred TanStack to).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24, // 24h — survives kill via the persister
      retry: 2,
    },
    mutations: { retry: 1 },
  },
});

/** Persists the cache to AsyncStorage so queries/mutations survive an app kill. */
export const asyncStoragePersister = createAsyncStoragePersister({ storage: AsyncStorage });
