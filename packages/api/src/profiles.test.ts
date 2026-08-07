import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import {
  getOwnProfile,
  getProfileById,
  getProfileIdByHandle,
  getProfileStatCounts,
  profileKeys,
} from './profiles';

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

describe('getProfileById (get_person_profile RPC — M10 visibility)', () => {
  const row = {
    id: '00000000-0000-0000-0000-000000000001',
    handle: 'alice',
    bio: null, // 'private' field arrives NULLed by the DEFINER RPC
    identity_tags: ['maker'],
    seeking: null,
    identity_verified: false,
    founding_member: false,
  };

  it('calls the RPC and passes NULLed private fields through', async () => {
    const { client, calls } = rpcStub(row);
    const person = await getProfileById(client, row.id);
    expect(calls).toEqual([{ fn: 'get_person_profile', args: { p_profile_id: row.id } }]);
    expect(person?.bio).toBeNull();
    expect(person?.identity_tags).toEqual(['maker']);
    expect(person?.seeking).toBeNull();
  });

  it('returns null for unknown / blocked ids (zero rows)', async () => {
    const { client } = rpcStub(null);
    expect(await getProfileById(client, 'nope')).toBeNull();
  });
});

describe('getOwnProfile (get_own_profile RPC)', () => {
  it('reads the full own row through the RPC', async () => {
    const own = {
      id: '00000000-0000-0000-0000-000000000002',
      handle: 'me_stessa',
      bio: 'segreto',
      locale: 'it',
      visibility: { bio: 'private' },
      identity_tags: [],
      seeking: [],
      identity_verified: false,
      founding_member: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const { client, calls } = rpcStub(own);
    const profile = await getOwnProfile(client, own.id);
    expect(calls[0]?.fn).toBe('get_own_profile');
    expect(profile?.bio).toBe('segreto');
    expect(profile?.visibility).toEqual({ bio: 'private' });
  });
});

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
