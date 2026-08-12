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

import { loadSeenStoryIds, persistSeenStoryIds } from './story-seen';

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
  it('round-trips a set of author ids', async () => {
    await persistSeenStoryIds(new Set(['aaa', 'bbb']));
    expect(await loadSeenStoryIds()).toEqual(new Set(['aaa', 'bbb']));
  });

  it('nothing stored → empty set', async () => {
    expect(await loadSeenStoryIds()).toEqual(new Set());
  });

  it('corrupt JSON → empty set, no throw (rings re-light, nothing breaks)', async () => {
    store.mem.set(KEY, '{nope');
    expect(await loadSeenStoryIds()).toEqual(new Set());
  });

  it('version mismatch → empty set (old formats invalidated, not migrated)', async () => {
    store.mem.set(KEY, JSON.stringify({ v: 99, ids: ['aaa'] }));
    expect(await loadSeenStoryIds()).toEqual(new Set());
  });

  it('drops non-string ids instead of poisoning the set', async () => {
    store.mem.set(KEY, JSON.stringify({ v: 1, ids: ['aaa', 7, null, 'bbb'] }));
    expect(await loadSeenStoryIds()).toEqual(new Set(['aaa', 'bbb']));
  });

  it('caps the persisted list, keeping the newest ids', async () => {
    const ids = Array.from({ length: 205 }, (_, i) => `id-${i}`);
    await persistSeenStoryIds(new Set(ids));
    const loaded = await loadSeenStoryIds();
    expect(loaded.size).toBe(200);
    expect(loaded.has('id-204')).toBe(true); // newest kept
    expect(loaded.has('id-0')).toBe(false); // oldest dropped
  });

  it('a failed write is swallowed — worst case a ring re-lights after restart', async () => {
    store.throwOnSet = true;
    await expect(persistSeenStoryIds(new Set(['aaa']))).resolves.toBeUndefined();
  });
});
