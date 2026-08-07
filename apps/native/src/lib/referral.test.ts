import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => new Map<string, string>());

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => mem.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: async (k: string) => {
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
