import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => new Map<string, string>());
// Flip to make every AsyncStorage call reject — a full disk, a corrupted store, a native bridge
// that never came up. The failing-mode tests below are what pin the never-reject contract.
const storage = vi.hoisted(() => ({ failing: false }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => {
      if (storage.failing) throw new Error('storage unavailable');
      return mem.get(k) ?? null;
    },
    setItem: async (k: string, v: string) => {
      if (storage.failing) throw new Error('storage unavailable');
      mem.set(k, v);
    },
    removeItem: async (k: string) => {
      if (storage.failing) throw new Error('storage unavailable');
      mem.delete(k);
    },
  },
}));

import { clearPendingReferral, getPendingReferral, setPendingReferral } from './referral';

const KEY = 'athanor.pendingReferral';

beforeEach(() => {
  mem.clear();
});

describe('referral', () => {
  it('valid code is trimmed, uppercased, and persisted', async () => {
    await setPendingReferral('  abc123  ');
    expect(mem.get(KEY)).toBe('ABC123');
    expect(await getPendingReferral()).toBe('ABC123');
  });

  it('junk never persists', async () => {
    await setPendingReferral('ab1'); // too short
    await setPendingReferral('A'.repeat(13)); // too long
    await setPendingReferral('abc-123'); // bad char
    await setPendingReferral(''); // empty
    expect(mem.size).toBe(0);
    expect(await getPendingReferral()).toBeNull();
  });

  it('get/clear round-trip', async () => {
    await setPendingReferral('FRIEND22');
    expect(await getPendingReferral()).toBe('FRIEND22');
    await clearPendingReferral();
    expect(await getPendingReferral()).toBeNull();
  });
});

// #179: welcome.tsx fires `void clearPendingReferral()` on both auth paths and awaits
// `getPendingReferral()` inside `submit`, and invite/[code].tsx awaits `setPendingReferral`
// before `router.replace`. A rejection from any of them either went unhandled or stranded the
// screen (`submitting` stuck true, the deep-link catcher never handing off). The stash is a
// nicety; storage failing must degrade to "no referral", dev-visible, never to a broken flow.
describe('referral storage failure never rejects', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    storage.failing = true;
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    storage.failing = false;
    warn.mockRestore();
  });

  it('setPendingReferral resolves and dev-logs instead of rejecting', async () => {
    await expect(setPendingReferral('FRIEND22')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[referral] set', expect.any(Error));
  });

  it('getPendingReferral resolves null instead of rejecting', async () => {
    await expect(getPendingReferral()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith('[referral] get', expect.any(Error));
  });

  it('clearPendingReferral resolves instead of rejecting', async () => {
    await expect(clearPendingReferral()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[referral] clear', expect.any(Error));
  });

  it('junk still short-circuits before touching storage', async () => {
    await expect(setPendingReferral('ab1')).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});
