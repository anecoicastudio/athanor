import { describe, expect, test, vi } from 'vitest';
import { PROFILE_READ_RETRIES, isValidationFailure, readProfileWithRetry } from './profile-read';

/** A ZodError as `profileSchema.parse` throws it — matched by name, not by instance. */
const zodError = () => Object.assign(new Error('invalid_type'), { name: 'ZodError' });

/** Collects the delays instead of waiting them out. */
const fakeSleep = () => {
  const waited: number[] = [];
  return { waited, sleep: (ms: number) => (waited.push(ms), Promise.resolve()) };
};

describe('readProfileWithRetry', () => {
  test('a read that succeeds first time is not retried and never sleeps', async () => {
    const { waited, sleep } = fakeSleep();
    const read = vi.fn().mockResolvedValue({ id: 'p1' });
    await expect(readProfileWithRetry(read, { sleep })).resolves.toEqual({ id: 'p1' });
    expect(read).toHaveBeenCalledTimes(1);
    expect(waited).toEqual([]);
  });

  // #512 — the whole point: ONE dropped request on sign-in used to reach the member as
  // «Il server non risponde». A second attempt has to resolve it before anyone sees a screen.
  test('one dropped request is absorbed — the caller sees the success, not the failure', async () => {
    const { waited, sleep } = fakeSleep();
    const read = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValue({ id: 'p1' });
    await expect(readProfileWithRetry(read, { sleep })).resolves.toEqual({ id: 'p1' });
    expect(read).toHaveBeenCalledTimes(2);
    expect(waited).toEqual([1000]);
  });

  test('a Supabase transport error object (not an Error) is retried too', async () => {
    const { sleep } = fakeSleep();
    const read = vi
      .fn()
      .mockRejectedValueOnce({ message: 'fetch failed', code: '' })
      .mockResolvedValue({ id: 'p1' });
    await expect(readProfileWithRetry(read, { sleep })).resolves.toEqual({ id: 'p1' });
    expect(read).toHaveBeenCalledTimes(2);
  });

  test('a persistent failure gives up after the shared retry budget and rethrows', async () => {
    const { waited, sleep } = fakeSleep();
    const boom = new TypeError('Network request failed');
    const read = vi.fn().mockRejectedValue(boom);
    await expect(readProfileWithRetry(read, { sleep })).rejects.toBe(boom);
    expect(read).toHaveBeenCalledTimes(PROFILE_READ_RETRIES + 1);
    expect(waited).toEqual([1000, 2000]); // the shared client's own backoff curve
  });

  // A malformed row is not a dropped packet: the next two attempts read the same bad row and
  // fail identically, so retrying only delays the error screen the member has to see.
  test('a schema failure is NOT retried — it is not going to fix itself', async () => {
    const { waited, sleep } = fakeSleep();
    const bad = zodError();
    const read = vi.fn().mockRejectedValue(bad);
    await expect(readProfileWithRetry(read, { sleep })).rejects.toBe(bad);
    expect(read).toHaveBeenCalledTimes(1);
    expect(waited).toEqual([]);
  });

  // getOwnProfile returns null for a missing row and never throws, so "no profile yet" must
  // travel through as a value — retrying it would stall a brand-new account's funnel.
  test('a null profile is a value, not a failure — returned on the first attempt', async () => {
    const read = vi.fn().mockResolvedValue(null);
    await expect(
      readProfileWithRetry(read, { sleep: () => Promise.resolve() }),
    ).resolves.toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('the retry budget is the shared query client’s, not a second policy', () => {
    expect(PROFILE_READ_RETRIES).toBe(2);
  });
});

describe('isValidationFailure', () => {
  test('matches a ZodError by name, so a cross-realm copy still counts', () => {
    expect(isValidationFailure(zodError())).toBe(true);
  });

  test('does not match transport failures', () => {
    expect(isValidationFailure(new TypeError('Network request failed'))).toBe(false);
    expect(isValidationFailure({ message: 'fetch failed' })).toBe(false);
    expect(isValidationFailure(null)).toBe(false);
    expect(isValidationFailure(undefined)).toBe(false);
  });
});
