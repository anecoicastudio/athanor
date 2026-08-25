import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => new Map<string, string>());
// Flip to make every AsyncStorage call reject — a full disk, a corrupted store, a native bridge
// that never came up. The failing-mode tests below are what pin the never-reject contract.
const storage = vi.hoisted(() => ({ failing: false }));

// The RPC behind consumePendingReferral. `failing` is the transport failure — the one case
// that must NOT drop the stash, because the server never ruled.
const rpc = vi.hoisted(() => ({ codes: [] as string[], failing: false }));

vi.mock('@athanor/api', () => ({
  redeemPendingReferral: async (_client: unknown, code: string) => {
    rpc.codes.push(code);
    if (rpc.failing) throw Object.assign(new Error('network down'), { code: '57P01' });
  },
}));

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

import {
  clearPendingReferral,
  consumePendingReferral,
  getPendingReferral,
  setPendingReferral,
} from './referral';

const KEY = 'athanor.pendingReferral';

beforeEach(() => {
  mem.clear();
  rpc.codes.length = 0;
  rpc.failing = false;
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

// #179: welcome.tsx clears the stash up front on the two paths that announce an existing
// account and awaits `getPendingReferral()` inside `submit`, invite/[code].tsx awaits
// `setPendingReferral` before `router.replace`, and auth-context consumes the stash on the
// first authenticated boot (#78). A rejection from any of them either went unhandled or
// stranded the screen (`submitting` stuck true, the deep-link catcher never handing off). The
// stash is a nicety; storage failing must degrade to "no referral", dev-visible, never to a
// broken flow.
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

// #78 — the OAuth signup's only redemption path. An OAuth user carries no user_metadata, so
// the auth.users triggers redeem nothing for them; the stash is spent here instead, once the
// session exists. Consuming it here is also what keeps a stale code from mis-attributing a
// later signup on the same device.
describe('consumePendingReferral', () => {
  const client = {} as never;

  it('with no stash it never reaches the network', async () => {
    await consumePendingReferral(client);
    expect(rpc.codes).toEqual([]);
  });

  it('redeems the stashed code and then drops it', async () => {
    await setPendingReferral('FRIEND22');
    await consumePendingReferral(client);
    expect(rpc.codes).toEqual(['FRIEND22']);
    expect(await getPendingReferral()).toBeNull();
  });

  it('drops the stash even when the server redeemed nothing — a refusal is still a verdict', async () => {
    // The RPC no-ops on every refusal (unconfirmed, already attributed, account too old) and
    // resolves all the same. Keeping the code after that is what mis-attributes the next
    // signup on this device, so "resolved" is the clear signal, not "redeemed".
    await setPendingReferral('FRIEND22');
    await consumePendingReferral(client);
    await setPendingReferral('OTHER22');
    await consumePendingReferral(client);
    expect(rpc.codes).toEqual(['FRIEND22', 'OTHER22']);
    expect(await getPendingReferral()).toBeNull();
  });

  it('a rejected call keeps the stash, so the next boot can try again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    rpc.failing = true;
    await setPendingReferral('FRIEND22');
    await expect(consumePendingReferral(client)).resolves.toBeUndefined();
    expect(await getPendingReferral()).toBe('FRIEND22');
    warn.mockRestore();
  });

  it('never rejects when the RPC does — a boot must not fail over a referral', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    rpc.failing = true;
    await setPendingReferral('FRIEND22');
    await expect(consumePendingReferral(client)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[referral] redeem', expect.any(Error));
    warn.mockRestore();
  });

  it('storage failing reads as no referral, never as a redemption', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.failing = true;
    await expect(consumePendingReferral(client)).resolves.toBeUndefined();
    expect(rpc.codes).toEqual([]);
    storage.failing = false;
    warn.mockRestore();
  });
});
