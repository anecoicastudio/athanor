import * as aesjs from 'aes-js';

// Supabase's documented "LargeSecureStore" pattern for Expo: SecureStore caps
// values at 2048 bytes, so the (larger) session JSON is AES-256-CTR encrypted
// into AsyncStorage while only the 32-byte encryption key lives in SecureStore.
// Crypto steps follow the Supabase Expo tutorial verbatim — the docs warn that
// "optimizations" here can introduce subtle vulnerabilities. CTR with a fixed
// Counter(1) is safe ONLY because _encrypt generates a fresh random key on
// every write; never reuse the key across encryptions.

export interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function createLargeSecureStore(deps: {
  secureStore: SecureStoreLike;
  asyncStorage: AsyncStorageLike;
}) {
  const { secureStore, asyncStorage } = deps;

  const encrypt = async (key: string, value: string): Promise<string> => {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(256 / 8));

    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));

    await secureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));

    return aesjs.utils.hex.fromBytes(encryptedBytes);
  };

  const decrypt = (encryptionKeyHex: string, value: string): string => {
    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(encryptionKeyHex),
      new aesjs.Counter(1),
    );
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));

    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  };

  const setItem = async (key: string, value: string): Promise<void> => {
    const encrypted = await encrypt(key, value);
    await asyncStorage.setItem(key, encrypted);
  };

  const removeItem = async (key: string): Promise<void> => {
    await asyncStorage.removeItem(key);
    await secureStore.deleteItemAsync(key);
  };

  const getItem = async (key: string): Promise<string | null> => {
    const value = await asyncStorage.getItem(key);
    if (value == null) return null;

    const encryptionKeyHex = await secureStore.getItemAsync(key);
    if (encryptionKeyHex == null) {
      // Pre-P1.7 builds stored the session JSON in plaintext AsyncStorage with
      // no SecureStore key. Ciphertext is lowercase hex and can never start
      // with '{', so this discriminator is unambiguous: migrate JSON in place.
      if (value.startsWith('{')) {
        await setItem(key, value);
        return value;
      }
      // Orphan value with no key (e.g. a stale PKCE code-verifier): unusable.
      await removeItem(key);
      return null;
    }

    try {
      return decrypt(encryptionKeyHex, value);
    } catch {
      // Corrupt key or ciphertext — fail safe to signed-out, never crash boot.
      await removeItem(key);
      return null;
    }
  };

  return { getItem, setItem, removeItem };
}
