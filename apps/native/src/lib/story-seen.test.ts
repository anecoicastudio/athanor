import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ mem: new Map<string, string>(), throwOnSet: false }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.mem.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      if (store.throwOnSet) throw new Error('disk full');
      store.mem.set(k, v);
    },
    removeItem: async (k: string) => {
      store.mem.delete(k);
    },
  },
}));

import { loadSeenStoryIds, persistSeenStoryIds, sanitizeSeenIds } from './story-seen';

const KEY = 'athanor.stories.seen';

beforeEach(() => {
  store.mem.clear();
  store.throwOnSet = false;
  vi.spyOn(console, 'warn').mockImplementation(() => {}); // silence __DEV__ warnings
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('persistSeenStoryIds / loadSeenStoryIds', () => {
  it('round-trips a list of author ids', async () => {
    await persistSeenStoryIds(['aaa', 'bbb']);
    expect(await loadSeenStoryIds()).toEqual(['aaa', 'bbb']);
  });

  it('nothing stored → empty list', async () => {
    expect(await loadSeenStoryIds()).toEqual([]);
  });

  it('corrupt JSON → empty list, no throw (rings re-light, nothing breaks)', async () => {
    store.mem.set(KEY, '{nope');
    expect(await loadSeenStoryIds()).toEqual([]);
  });

  it('version mismatch → empty list (old formats invalidated, not migrated)', async () => {
    store.mem.set(KEY, JSON.stringify({ v: 99, ids: ['aaa'] }));
    expect(await loadSeenStoryIds()).toEqual([]);
  });

  it('drops non-string ids instead of poisoning the list', async () => {
    store.mem.set(KEY, JSON.stringify({ v: 1, ids: ['aaa', 7, null, 'bbb'] }));
    expect(await loadSeenStoryIds()).toEqual(['aaa', 'bbb']);
  });

  it('deduplicates ids on persist', async () => {
    await persistSeenStoryIds(['aaa', 'aaa', 'bbb']);
    expect(await loadSeenStoryIds()).toEqual(['aaa', 'bbb']);
  });

  it('caps the persisted list, keeping the newest ids', async () => {
    const ids = Array.from({ length: 205 }, (_, i) => `id-${i}`);
    await persistSeenStoryIds(ids);
    const loaded = await loadSeenStoryIds();
    expect(loaded.length).toBe(200);
    expect(loaded.includes('id-204')).toBe(true); // newest kept
    expect(loaded.includes('id-0')).toBe(false); // oldest dropped
  });

  it('a failed write is swallowed — worst case a ring re-lights after restart', async () => {
    store.throwOnSet = true;
    await expect(persistSeenStoryIds(['aaa'])).resolves.toBeUndefined();
  });

  it('returns query-cache-safe data: a JSON round-trip preserves it exactly', async () => {
    // The query persister serializes cache data with JSON.stringify; anything the
    // queryFn returns must survive that unchanged (a Set would not — it becomes {}).
    await persistSeenStoryIds(['aaa', 'bbb']);
    const loaded = await loadSeenStoryIds();
    expect(Array.isArray(loaded)).toBe(true);
    expect(JSON.parse(JSON.stringify(loaded))).toEqual(loaded);
  });
});

describe('sanitizeSeenIds', () => {
  it('survives the pre-fix persister round-trip (Set → "{}" → restore)', () => {
    // Regression for the seenIds.has crash: a Set persisted through the query
    // persister rehydrates as a plain object, which is defined but has no .has.
    const poisoned: unknown = JSON.parse(JSON.stringify(new Set(['aaa', 'bbb'])));
    expect(poisoned).toEqual({}); // documents the failure mode
    expect(sanitizeSeenIds(poisoned)).toEqual([]); // no throw, degrades to empty
    expect(new Set(sanitizeSeenIds(poisoned)).has('aaa')).toBe(false);
    expect([...sanitizeSeenIds(poisoned), 'ccc']).toEqual(['ccc']); // markSeen path recovers
  });

  it('nullish input → empty list', () => {
    expect(sanitizeSeenIds(undefined)).toEqual([]);
    expect(sanitizeSeenIds(null)).toEqual([]);
  });

  it('drops non-string entries from an array', () => {
    expect(sanitizeSeenIds(['a', 7, null, 'b'])).toEqual(['a', 'b']);
  });

  it('passes a valid list through unchanged', () => {
    expect(sanitizeSeenIds(['a', 'b'])).toEqual(['a', 'b']);
  });
});
