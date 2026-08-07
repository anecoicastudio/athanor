import { describe, expect, it, vi } from 'vitest';
import type { AthanorClient } from './client';
import {
  getVerificationStatus,
  requestVerification,
  subscribeVerifyStatus,
  verifyKeys,
} from './verifications';

const ME = '00000000-0000-0000-0000-000000000001';

type Call = { method: string; arg: unknown; arg2?: unknown };

/** Per-table thenable builder stub: records `table.method` calls; maybeSingle resolves the table's result. */
function tableStub(results: Record<string, { data: unknown; error: unknown }>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit']) {
      chain[m] = (arg?: unknown, arg2?: unknown) => {
        calls.push({ method: `${table}.${m}`, arg, arg2 });
        return chain;
      };
    }
    chain['maybeSingle'] = () => {
      calls.push({ method: `${table}.maybeSingle`, arg: undefined });
      return Promise.resolve(results[table] ?? { data: null, error: null });
    };
    return chain;
  };
  return { from, calls };
}

function authedClient(
  results: Record<string, { data: unknown; error: unknown }>,
  user: { id: string } | null = { id: ME },
  userErr: unknown = null,
) {
  const { from, calls } = tableStub(results);
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: userErr }) },
    from,
  } as unknown as AthanorClient;
  return { client, calls };
}

describe('verifyKeys', () => {
  it('status factory shape', () => {
    expect(verifyKeys.all).toEqual(['verify']);
    expect(verifyKeys.status()).toEqual(['verify', 'status']);
  });
});

describe('getVerificationStatus', () => {
  it('throws "not authenticated" when there is no user and no auth error', async () => {
    const { client } = authedClient({}, null);
    await expect(getVerificationStatus(client)).rejects.toThrow('not authenticated');
  });

  it('throws the auth error itself when getUser errors', async () => {
    const { client } = authedClient({}, null, new Error('jwt expired'));
    await expect(getVerificationStatus(client)).rejects.toThrow('jwt expired');
  });

  it('queries profiles.identity_verified by id and the latest verification (created_at desc, id desc, limit 1)', async () => {
    const { client, calls } = authedClient({
      profiles: { data: { identity_verified: true }, error: null },
      verifications: { data: { status: 'verified' }, error: null },
    });
    const result = await getVerificationStatus(client);
    expect(result).toEqual({ identityVerified: true, latestStatus: 'verified' });

    expect(calls.some((c) => c.method === 'profiles.select' && c.arg === 'identity_verified')).toBe(
      true,
    );
    expect(calls.some((c) => c.method === 'profiles.eq' && c.arg === 'id' && c.arg2 === ME)).toBe(
      true,
    );
    expect(calls.some((c) => c.method === 'profiles.maybeSingle')).toBe(true);

    expect(
      calls.some((c) => c.method === 'verifications.eq' && c.arg === 'profile_id' && c.arg2 === ME),
    ).toBe(true);
    const orders = calls.filter((c) => c.method === 'verifications.order');
    expect(orders.map((c) => c.arg)).toEqual(['created_at', 'id']);
    expect(orders.every((c) => (c.arg2 as { ascending: boolean }).ascending === false)).toBe(true);
    expect(calls.some((c) => c.method === 'verifications.limit' && c.arg === 1)).toBe(true);
    expect(calls.some((c) => c.method === 'verifications.maybeSingle')).toBe(true);
  });

  it('defaults to identityVerified=false / latestStatus=null when both rows are missing', async () => {
    const { client } = authedClient({
      profiles: { data: null, error: null },
      verifications: { data: null, error: null },
    });
    await expect(getVerificationStatus(client)).resolves.toEqual({
      identityVerified: false,
      latestStatus: null,
    });
  });
});

describe('requestVerification', () => {
  it('invokes the create-verification-session edge function and passes the url through', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { url: 'https://verify' }, error: null });
    const client = { functions: { invoke } } as unknown as AthanorClient;
    await expect(requestVerification(client)).resolves.toEqual({ url: 'https://verify' });
    expect(invoke).toHaveBeenCalledWith('create-verification-session', { body: {} });
  });

  it('passes a clientSecret payload through', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { clientSecret: 'cs_1' }, error: null });
    const client = { functions: { invoke } } as unknown as AthanorClient;
    await expect(requestVerification(client)).resolves.toEqual({ clientSecret: 'cs_1' });
  });

  it('throws on invoke error', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: new Error('fn down') });
    const client = { functions: { invoke } } as unknown as AthanorClient;
    await expect(requestVerification(client)).rejects.toThrow('fn down');
  });

  it('throws when the function returns no session', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { functions: { invoke } } as unknown as AthanorClient;
    await expect(requestVerification(client)).rejects.toThrow('no verification session returned');
  });
});

describe('subscribeVerifyStatus', () => {
  it('listens on the caller-scoped profiles filter and returns a cleanup that removes the channel', () => {
    let onArgs: unknown[] = [];
    let removed: unknown = null;
    const channel = {
      on: (...args: unknown[]) => {
        onArgs = args;
        return channel;
      },
      subscribe: () => channel,
    };
    const client = {
      channel: () => channel,
      removeChannel: (c: unknown) => {
        removed = c;
      },
    } as unknown as AthanorClient;

    const cleanup = subscribeVerifyStatus(client, ME, () => {});
    expect(onArgs[0]).toBe('postgres_changes');
    expect(onArgs[1]).toEqual({
      event: 'UPDATE',
      schema: 'public',
      table: 'profiles',
      filter: `id=eq.${ME}`,
    });
    expect(typeof cleanup).toBe('function');
    cleanup();
    expect(removed).toBe(channel);
  });
});
