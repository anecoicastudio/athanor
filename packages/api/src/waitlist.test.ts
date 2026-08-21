import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import { makeFakeClient, type FakeResult } from './test-support/fake-client';
import { WAITLIST_RATE_LIMITED_CODE, isWaitlistRateLimited, subscribeToWaitlist } from './waitlist';

const db = (script: Record<string, FakeResult[]> = {}) => {
  const fake = makeFakeClient(script);
  return { fake, client: fake as unknown as AthanorClient };
};

describe('subscribeToWaitlist', () => {
  it('inserts the validated payload into email_waitlist and reports a fresh signup', async () => {
    const { fake, client } = db();
    const result = await subscribeToWaitlist(client, { email: 'a@b.com', locale: 'it' });

    expect(result).toEqual({ ok: true, duplicate: false });
    const call = fake.calls[0]!;
    expect(call.table).toBe('email_waitlist');
    expect(call.op).toBe('insert');
    expect(call.values).toMatchObject({ email: 'a@b.com', locale: 'it' });
  });

  it('swallows a unique violation (23505) as duplicate:true', async () => {
    const { client } = db({
      'email_waitlist.insert': [{ error: { code: '23505', message: 'duplicate key' } }],
    });
    await expect(subscribeToWaitlist(client, { email: 'a@b.com', locale: 'it' })).resolves.toEqual({
      ok: true,
      duplicate: true,
    });
  });

  it('rethrows any other db error', async () => {
    const { client } = db({
      'email_waitlist.insert': [{ error: { code: '23502', message: 'not null violation' } }],
    });
    await expect(
      subscribeToWaitlist(client, { email: 'a@b.com', locale: 'it' }),
    ).rejects.toBeTruthy();
  });

  it('validates before touching the database', async () => {
    const { fake, client } = db();
    await expect(
      subscribeToWaitlist(client, { email: 'not-an-email', locale: 'it' }),
    ).rejects.toThrow();
    expect(fake.calls).toEqual([]);
  });
});

// The admin readers (count, keyset page) moved to admin.ts with #335 — tested there.

describe('isWaitlistRateLimited', () => {
  it('recognises the throttle trigger refusing', () => {
    expect(isWaitlistRateLimited({ code: 'PT429', message: 'waitlist_rate_limited' })).toBe(true);
  });

  it('keys on the CODE alone, so message decoration cannot break it', () => {
    // Drivers wrap `message` differently across versions; a substring match on it would be a
    // security control hostage to formatting. The SQLSTATE is the contract.
    expect(isWaitlistRateLimited({ code: WAITLIST_RATE_LIMITED_CODE })).toBe(true);
    expect(
      isWaitlistRateLimited({
        code: 'PT429',
        message:
          'waitlist_rate_limited\nCONTEXT: PL/pgSQL function athanor.waitlist_throttle_check()',
      }),
    ).toBe(true);
  });

  it('is NOT a bare P0001 — that is what any other raise on this table would give', () => {
    // The reason the trigger uses a distinct SQLSTATE rather than a plain `raise exception`:
    // answering 429 to an unrelated failure would tell a member to slow down when nothing was
    // too fast, and PostgREST would have mapped it to 400 anyway.
    expect(isWaitlistRateLimited({ code: 'P0001', message: 'waitlist_rate_limited' })).toBe(false);
    expect(isWaitlistRateLimited({ code: 'P0001', message: 'some other check failed' })).toBe(
      false,
    );
  });

  it('pins the code the migration raises — the two must not drift apart', () => {
    expect(WAITLIST_RATE_LIMITED_CODE).toBe('PT429');
  });

  it('is false for the errors this route actually sees otherwise', () => {
    expect(isWaitlistRateLimited({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isWaitlistRateLimited({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isWaitlistRateLimited(new Error('network'))).toBe(false);
  });

  it('never throws on a shape it did not expect', () => {
    // It runs inside a catch block. Throwing here would turn a handled refusal into an
    // unhandled rejection — the one place a type guard must not be clever.
    for (const v of [null, undefined, 'PT429', 0, [], {}, { message: 'x' }, { code: 429 }]) {
      expect(isWaitlistRateLimited(v)).toBe(false);
    }
  });
});
