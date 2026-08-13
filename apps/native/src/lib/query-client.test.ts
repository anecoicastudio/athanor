import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));

import { dehydrate, QueryClient } from '@tanstack/react-query';
import { shouldDehydrateQuery } from './query-client';

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
