import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteConfigSnapshot } from '@athanor/api';

const store = vi.hoisted(() => ({
  mem: new Map<string, string>(),
  throwOnGet: false,
  throwOnSet: false,
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => {
      if (store.throwOnGet) throw new Error('disk error');
      return store.mem.get(k) ?? null;
    },
    setItem: async (k: string, v: string) => {
      if (store.throwOnSet) throw new Error('disk full');
      store.mem.set(k, v);
    },
    removeItem: async (k: string) => {
      store.mem.delete(k);
    },
  },
}));

import { loadConfigSnapshot, saveConfigSnapshot } from './config-snapshot';

const LKG_KEY = 'athanor.remote-config.lkg.v1';

const SNAP: RemoteConfigSnapshot = {
  minAppVersion: { ios: '1.2.0', android: '1.1.0' },
  maintenance: { enabled: false, eta: null },
  flags: { fund: true },
};

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  store.mem.clear();
  store.throwOnGet = false;
  store.throwOnSet = false;
});

describe('saveConfigSnapshot', () => {
  it('persists the snapshot fire-and-forget with a savedAt stamp', async () => {
    saveConfigSnapshot(SNAP);
    await flush();

    const raw = store.mem.get(LKG_KEY);
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!);
    expect(parsed.minAppVersion).toEqual(SNAP.minAppVersion);
    expect(parsed.maintenance).toEqual(SNAP.maintenance);
    expect(parsed.flags).toEqual(SNAP.flags);
    expect(new Date(parsed.savedAt).getTime()).not.toBeNaN();
  });

  it('a failed write does not throw (previous snapshot stays)', async () => {
    store.throwOnSet = true;
    expect(() => saveConfigSnapshot(SNAP)).not.toThrow();
    await flush();
    expect(store.mem.has(LKG_KEY)).toBe(false);
  });
});

describe('loadConfigSnapshot', () => {
  it('returns only the gate inputs from a valid snapshot (flags never served)', async () => {
    saveConfigSnapshot(SNAP);
    await flush();

    expect(await loadConfigSnapshot()).toEqual({
      minAppVersion: { ios: '1.2.0', android: '1.1.0' },
      maintenance: { enabled: false, eta: null },
    });
  });

  it('null when nothing is stored', async () => {
    expect(await loadConfigSnapshot()).toBeNull();
  });

  it('null on corrupt JSON', async () => {
    store.mem.set(LKG_KEY, 'not-json{');
    expect(await loadConfigSnapshot()).toBeNull();
  });

  it('null on a schema-invalid snapshot', async () => {
    store.mem.set(LKG_KEY, JSON.stringify({ minAppVersion: 'nope' }));
    expect(await loadConfigSnapshot()).toBeNull();
  });

  it('null when storage throws', async () => {
    store.throwOnGet = true;
    expect(await loadConfigSnapshot()).toBeNull();
  });
});
