import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import { getProfileIdByHandle, getProfileStatCounts, profileKeys } from './profiles';

describe('profileKeys', () => {
  it('namespaces under profiles and derives stable sub-keys', () => {
    expect(profileKeys.all).toEqual(['profiles']);
    expect(profileKeys.detail('p1')).toEqual(['profiles', 'p1']);
    expect(profileKeys.statCounts('p1')).toEqual(['profiles', 'p1', 'stat-counts']);
  });
});

/** rpc().maybeSingle() stub — resolves to { data, error }. */
function rpcStub(data: unknown) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  return {
    calls,
    client: {
      rpc: (fn: string, args: unknown) => {
        calls.push({ fn, args });
        return {
          maybeSingle: () => Promise.resolve({ data, error: null }),
        };
      },
    } as unknown as AthanorClient,
  };
}

describe('getProfileStatCounts', () => {
  it('maps the RPC row to camelCase counts', async () => {
    const { client, calls } = rpcStub({ collabs_count: 3, events_count: 2 });
    const counts = await getProfileStatCounts(client, 'p1');
    expect(counts).toEqual({ collabsCount: 3, eventsCount: 2 });
    expect(calls).toEqual([{ fn: 'profile_stat_counts', args: { p_profile_id: 'p1' } }]);
  });

  it('coalesces a zero-row result (blocked / unknown id) to zeros', async () => {
    const { client } = rpcStub(null);
    const counts = await getProfileStatCounts(client, 'p1');
    expect(counts).toEqual({ collabsCount: 0, eventsCount: 0 });
  });
});

describe('getProfileIdByHandle', () => {
  const chainFor = (result: { data: unknown; error: unknown }, calls: unknown[]) => {
    const chain = {
      select: (sel: string) => {
        calls.push(['select', sel]);
        return chain;
      },
      eq: (col: string, v: unknown) => {
        calls.push(['eq', col, v]);
        return chain;
      },
      maybeSingle: () => Promise.resolve(result),
    };
    return chain;
  };

  it('resolves a handle to the profile id', async () => {
    const calls: unknown[] = [];
    const client = {
      from: (t: string) => {
        calls.push(['from', t]);
        return chainFor({ data: { id: 'uuid-1' }, error: null }, calls);
      },
    } as unknown as AthanorClient;
    expect(await getProfileIdByHandle(client, 'luna')).toBe('uuid-1');
    expect(calls[0]).toEqual(['from', 'profiles']);
    expect(calls).toContainEqual(['eq', 'handle', 'luna']);
  });

  it('returns null when no row resolves (unknown or RLS-invisible)', async () => {
    const client = {
      from: () => chainFor({ data: null, error: null }, []),
    } as unknown as AthanorClient;
    expect(await getProfileIdByHandle(client, 'ghost')).toBeNull();
  });

  it('throws on query error', async () => {
    const client = {
      from: () => chainFor({ data: null, error: new Error('boom') }, []),
    } as unknown as AthanorClient;
    await expect(getProfileIdByHandle(client, 'luna')).rejects.toThrow('boom');
  });
});
