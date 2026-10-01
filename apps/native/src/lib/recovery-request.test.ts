import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => new Map<string, string>());
// Flip to make every AsyncStorage call reject — the never-reject contract is what lets
// auth-callback treat a storage failure as "no marker" instead of a stranded screen.
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

import {
  RECOVERY_REQUEST_TTL_MS,
  clearRecoveryRequest,
  readRecoveryRequest,
  rememberRecoveryRequest,
} from './recovery-request';

const T0 = 1_790_000_000_000;

beforeEach(() => {
  mem.clear();
  storage.failing = false;
});

describe('recovery request marker (#863)', () => {
  it('remembers the trimmed email and reads it back inside the window', async () => {
    await rememberRecoveryRequest('  a+b@example.com ', () => T0);
    expect(await readRecoveryRequest(() => T0 + 6 * 60_000)).toBe('a+b@example.com');
  });

  it('is gone past the window, and a stale read deletes it', async () => {
    await rememberRecoveryRequest('a@example.com', () => T0);
    expect(await readRecoveryRequest(() => T0 + RECOVERY_REQUEST_TTL_MS + 1)).toBeNull();
    expect(mem.size).toBe(0);
  });

  it('the window is the mail link lifetime, an hour — not the five-minute flow state', () => {
    // The flow state dies at 5 min; the link itself at mailer_otp_exp. A member opening a
    // 20-minute-old mail is exactly who the resend is for, so the marker must outlive it.
    expect(RECOVERY_REQUEST_TTL_MS).toBe(60 * 60_000);
  });

  it('a newer request replaces the older one', async () => {
    await rememberRecoveryRequest('old@example.com', () => T0);
    await rememberRecoveryRequest('new@example.com', () => T0 + 1000);
    expect(await readRecoveryRequest(() => T0 + 2000)).toBe('new@example.com');
  });

  it('clear drops it', async () => {
    await rememberRecoveryRequest('a@example.com', () => T0);
    await clearRecoveryRequest();
    expect(await readRecoveryRequest(() => T0)).toBeNull();
  });

  it('a malformed stash reads as none and is dropped', async () => {
    for (const raw of ['not json', '{}', '{"email":3,"at":1}', '{"email":"a@b.c"}', 'null']) {
      mem.set('athanor.recoveryRequest', raw);
      expect(await readRecoveryRequest(() => T0)).toBeNull();
      expect(mem.size).toBe(0);
    }
  });

  it('a future timestamp (clock moved back) reads as none', async () => {
    await rememberRecoveryRequest('a@example.com', () => T0 + 60_000);
    expect(await readRecoveryRequest(() => T0)).toBeNull();
  });

  it('never rejects when storage fails', async () => {
    storage.failing = true;
    await expect(rememberRecoveryRequest('a@example.com', () => T0)).resolves.toBeUndefined();
    await expect(readRecoveryRequest(() => T0)).resolves.toBeNull();
    await expect(clearRecoveryRequest()).resolves.toBeUndefined();
  });
});
