import { describe, expect, it } from 'vitest';
import {
  createLargeSecureStore,
  type AsyncStorageLike,
  type SecureStoreLike,
} from './large-secure-store';

const KEY = 'sb-kwzeiqvrnnaagccyoose-auth-token';
const SESSION_JSON = '{"access_token":"abc","refresh_token":"def"}';

function makeStubs() {
  const secure = new Map<string, string>();
  const plain = new Map<string, string>();
  const secureStore: SecureStoreLike = {
    getItemAsync: async (k) => secure.get(k) ?? null,
    setItemAsync: async (k, v) => {
      secure.set(k, v);
    },
    deleteItemAsync: async (k) => {
      secure.delete(k);
    },
  };
  const asyncStorage: AsyncStorageLike = {
    getItem: async (k) => plain.get(k) ?? null,
    setItem: async (k, v) => {
      plain.set(k, v);
    },
    removeItem: async (k) => {
      plain.delete(k);
    },
  };
  const store = createLargeSecureStore({ secureStore, asyncStorage });
  return { store, secure, plain };
}

describe('createLargeSecureStore', () => {
  it('round-trips a value, storing hex ciphertext and a 64-char hex key', async () => {
    const { store, secure, plain } = makeStubs();
    await store.setItem(KEY, SESSION_JSON);

    expect(plain.get(KEY)).toMatch(/^[0-9a-f]+$/);
    expect(plain.get(KEY)).not.toContain('access_token');
    expect(secure.get(KEY)).toMatch(/^[0-9a-f]{64}$/);
    expect(await store.getItem(KEY)).toBe(SESSION_JSON);
  });

  it('returns null when nothing is stored', async () => {
    const { store } = makeStubs();
    expect(await store.getItem(KEY)).toBeNull();
  });

  it('returns null when the encryption key exists but the value is gone', async () => {
    const { store, secure } = makeStubs();
    secure.set(KEY, 'aa'.repeat(32));
    expect(await store.getItem(KEY)).toBeNull();
  });

  it('migrates a legacy plaintext session: returns it and re-encrypts in place', async () => {
    const { store, secure, plain } = makeStubs();
    plain.set(KEY, SESSION_JSON);

    expect(await store.getItem(KEY)).toBe(SESSION_JSON);
    expect(plain.get(KEY)).toMatch(/^[0-9a-f]+$/);
    expect(secure.get(KEY)).toMatch(/^[0-9a-f]{64}$/);
    expect(await store.getItem(KEY)).toBe(SESSION_JSON);
  });

  it('clears an orphan non-JSON value that has no encryption key', async () => {
    const { store, plain, secure } = makeStubs();
    plain.set(KEY, 'legacy-code-verifier-value');

    expect(await store.getItem(KEY)).toBeNull();
    expect(plain.has(KEY)).toBe(false);
    expect(secure.has(KEY)).toBe(false);
  });

  it('fails safe on corrupt ciphertext: null, both entries cleared, no throw', async () => {
    const { store, secure, plain } = makeStubs();
    secure.set(KEY, 'aa'.repeat(32));
    plain.set(KEY, 'not-hex-at-all!!');

    expect(await store.getItem(KEY)).toBeNull();
    expect(plain.has(KEY)).toBe(false);
    expect(secure.has(KEY)).toBe(false);
  });

  it('fails safe on a corrupt encryption key: null, both entries cleared, no throw', async () => {
    const { store, secure, plain } = makeStubs();
    await store.setItem(KEY, SESSION_JSON);
    secure.set(KEY, 'zz-not-a-valid-key');

    expect(await store.getItem(KEY)).toBeNull();
    expect(plain.has(KEY)).toBe(false);
    expect(secure.has(KEY)).toBe(false);
  });

  it('removeItem deletes both the ciphertext and the encryption key', async () => {
    const { store, secure, plain } = makeStubs();
    await store.setItem(KEY, SESSION_JSON);
    await store.removeItem(KEY);

    expect(plain.has(KEY)).toBe(false);
    expect(secure.has(KEY)).toBe(false);
  });

  it('generates a fresh key on every setItem (Counter(1) reuse safety)', async () => {
    const { store, secure } = makeStubs();
    await store.setItem(KEY, SESSION_JSON);
    const first = secure.get(KEY);
    await store.setItem(KEY, SESSION_JSON);
    const second = secure.get(KEY);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
  });
});
