import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { defaultShouldDehydrateQuery, QueryClient, type Query } from '@tanstack/react-query';

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
    // `networkMode: 'always'` is load-bearing, not a style choice (#596). Under the default
    // ('online') a mutation is gated on `onlineManager.isOnline()` and PAUSED before
    // `mutationFn` ever runs: no request is issued, `isPending` stays true, and `onError`
    // never fires. Every screen that disables its CTA on `.isPending` — chat's «Invia», post
    // compose, report, delete account, a dozen more — then goes dead for the whole outage
    // with nothing said. Pausing would be worth that only if there were an offline queue to
    // pause INTO; there is none. Nothing wires `onlineManager` to NetInfo, so the signal
    // exists on web and not on device at all, and a paused mutation IS persisted by
    // `defaultShouldDehydrateMutation` and resumes into "No mutationFn found" (these
    // mutations carry no `mutationKey`, and nothing calls `setMutationDefaults`). Running and
    // failing is also what the copy already promises: «Non inviato. Tocca per riprovare.»
    //
    // Queries deliberately keep the default: `lib/list-state.ts` reads `fetchStatus: 'paused'`
    // as loading rather than empty (#111), and a read has the persisted cache to fall back on.
    mutations: { retry: 1, networkMode: 'always' },
  },
});

/** Persists the cache to AsyncStorage so queries/mutations survive an app kill. */
export const asyncStoragePersister = createAsyncStoragePersister({ storage: AsyncStorage });

/**
 * Queries owning their own durable storage opt out of the persisted cache with
 * `meta: { persist: false }` (see use-story-seen.ts — its data is already versioned in
 * AsyncStorage, and a second copy here shadows the canonical one under staleTime: Infinity).
 */
export function shouldDehydrateQuery(query: Query): boolean {
  return defaultShouldDehydrateQuery(query) && query.meta?.persist !== false;
}
