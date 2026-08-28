import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));

import { dehydrate, onlineManager, QueryClient } from '@tanstack/react-query';
import { queryClient, shouldDehydrateQuery } from './query-client';

describe('shouldDehydrateQuery', () => {
  it('skips queries with meta.persist === false, keeps normal ones', async () => {
    const qc = new QueryClient();
    await qc.prefetchQuery({
      queryKey: ['stories', 'seen-local'],
      queryFn: async () => ['a'],
      meta: { persist: false },
    });
    await qc.prefetchQuery({ queryKey: ['feed'], queryFn: async () => [1] });

    const dehydrated = dehydrate(qc, { shouldDehydrateQuery });

    expect(dehydrated.queries.map((q) => q.queryKey)).toEqual([['feed']]);
  });

  it('still excludes non-success queries (default behavior preserved)', async () => {
    const qc = new QueryClient();
    await qc.prefetchQuery({
      queryKey: ['broken'],
      queryFn: async () => {
        throw new Error('nope');
      },
      retry: false,
    });

    const dehydrated = dehydrate(qc, { shouldDehydrateQuery });

    expect(dehydrated.queries).toEqual([]);
  });
});

describe('offline write policy (#596)', () => {
  afterEach(() => {
    onlineManager.setOnline(true);
    queryClient.clear();
  });

  it('runs a mutation while offline and settles it into error rather than pausing it', async () => {
    onlineManager.setOnline(false);
    let calls = 0;
    const mutation = queryClient.getMutationCache().build(
      queryClient,
      queryClient.defaultMutationOptions({
        mutationFn: async () => {
          calls += 1;
          throw new Error('Failed to fetch');
        },
        retryDelay: 0,
      }),
    );

    await expect(mutation.execute(undefined)).rejects.toThrow('Failed to fetch');

    // The whole point of the fix: `mutationFn` actually RAN (a request was issued), the
    // mutation reached `error` so a screen's `onError` can fire and its CTA can come back,
    // and it never entered the paused state `defaultShouldDehydrateMutation` persists.
    // Under the default networkMode none of these hold — nothing runs and nothing settles.
    expect(calls).toBe(2); // the shared `retry: 1`, exercised offline rather than deferred
    expect(mutation.state.status).toBe('error');
    expect(mutation.state.isPaused).toBe(false);
  });

  it('leaves reads paused when offline — list-state reads paused as loading, not empty (#111)', () => {
    onlineManager.setOnline(false);
    const query = queryClient
      .getQueryCache()
      .build(
        queryClient,
        queryClient.defaultQueryOptions({ queryKey: ['offline-probe'], queryFn: async () => 'x' }),
      );

    const settled = query.fetch().catch(() => undefined);
    expect(query.state.fetchStatus).toBe('paused');

    void query.cancel({ silent: true });
    return settled;
  });
});
