import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import { subscribeToWaitlist, waitlistKeys } from './waitlist';

/** Minimal client whose insert resolves to { error } — enough for the 23505 contract. */
function clientWithError(error: { code?: string } | null) {
  return {
    from: () => ({
      insert: () => ({
        then: (resolve: (v: { error: unknown }) => void) => resolve({ error }),
      }),
    }),
  } as unknown as AthanorClient;
}

describe('waitlist api', () => {
  it('key factory shape', () => {
    expect(waitlistKeys.all).toEqual(['waitlist']);
  });

  it('returns duplicate:false on a fresh insert', async () => {
    const result = await subscribeToWaitlist(clientWithError(null), {
      email: 'a@b.com',
      locale: 'it',
    });
    expect(result).toEqual({ ok: true, duplicate: false });
  });

  it('swallows a unique violation (23505) as duplicate:true', async () => {
    const result = await subscribeToWaitlist(clientWithError({ code: '23505' }), {
      email: 'a@b.com',
      locale: 'it',
    });
    expect(result).toEqual({ ok: true, duplicate: true });
  });

  it('rethrows any other db error', async () => {
    await expect(
      subscribeToWaitlist(clientWithError({ code: '23502' }), { email: 'a@b.com', locale: 'it' }),
    ).rejects.toBeTruthy();
  });
});
