import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import { makeFakeClient, type FakeResult } from './test-support/fake-client';
import { getWaitlistCount, getWaitlistRows, subscribeToWaitlist, waitlistKeys } from './waitlist';

const db = (script: Record<string, FakeResult[]> = {}) => {
  const fake = makeFakeClient(script);
  return { fake, client: fake as unknown as AthanorClient };
};

const waitlistRow = (email: string, source: string | null = null) => ({
  email,
  locale: 'it',
  source,
  created_at: '2026-01-01T00:00:00Z',
});

describe('waitlist api', () => {
  it('key factory shape', () => {
    expect(waitlistKeys.all).toEqual(['waitlist']);
  });
});

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

// The two admin readers go through SECURITY DEFINER RPCs that re-check is_admin()
// server-side; this package is plumbing (api rule) and never gates on a client-side role.
describe('getWaitlistCount', () => {
  it('calls the admin_waitlist_count RPC with no client-supplied arguments', async () => {
    const { fake, client } = db({ 'rpc.admin_waitlist_count': [{ data: 42 }] });
    await expect(getWaitlistCount(client)).resolves.toBe(42);

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      table: 'rpc',
      op: 'rpc',
      columns: 'admin_waitlist_count',
    });
    // nothing the caller could use to widen the scope — the RPC derives the check itself
    expect(fake.calls[0]!.values).toBeUndefined();
  });

  it('coalesces a null count to zero', async () => {
    const { client } = db({ 'rpc.admin_waitlist_count': [{ data: null }] });
    await expect(getWaitlistCount(client)).resolves.toBe(0);
  });

  it('surfaces the 42501 a non-admin gets instead of reporting zero', async () => {
    const { client } = db({
      'rpc.admin_waitlist_count': [{ error: { code: '42501', message: 'not an admin' } }],
    });
    await expect(getWaitlistCount(client)).rejects.toThrow('not an admin');
  });
});

describe('getWaitlistRows', () => {
  it('reads a BOUNDED page and never an offset window (rule #9)', async () => {
    const { fake, client } = db({
      'rpc.admin_list_waitlist': [{ data: [waitlistRow('a@b.com')] }],
    });
    await getWaitlistRows(client);

    const call = fake.calls[0]!;
    expect(call.columns).toBe('admin_list_waitlist');
    expect(call.values).toEqual({ p_limit: 5000 });
    // no p_offset / range: the export is a capped read, not a paged walk
    expect(Object.keys(call.values as object)).toEqual(['p_limit']);
    expect(call.modifiers.map((m) => m[0])).not.toContain('range');
  });

  it('honours an explicit cap', async () => {
    const { fake, client } = db({ 'rpc.admin_list_waitlist': [{ data: [] }] });
    await getWaitlistRows(client, 10);
    expect(fake.calls[0]!.values).toEqual({ p_limit: 10 });
  });

  it('returns the rows as the RPC projects them', async () => {
    const { client } = db({
      'rpc.admin_list_waitlist': [
        { data: [waitlistRow('a@b.com', 'landing'), waitlistRow('c@d.com')] },
      ],
    });
    const rows = await getWaitlistRows(client);
    expect(rows.map((r) => r.email)).toEqual(['a@b.com', 'c@d.com']);
    // `source` is nullable in the column but not in the generated RPC return type
    expect(rows[1]!.source).toBeNull();
  });

  it('coalesces a null result to an empty list', async () => {
    const { client } = db({ 'rpc.admin_list_waitlist': [{ data: null }] });
    await expect(getWaitlistRows(client)).resolves.toEqual([]);
  });

  it('surfaces the 42501 a non-admin gets instead of an empty list', async () => {
    const { client } = db({
      'rpc.admin_list_waitlist': [{ error: { code: '42501', message: 'not an admin' } }],
    });
    await expect(getWaitlistRows(client)).rejects.toThrow('not an admin');
  });
});
