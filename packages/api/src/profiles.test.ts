import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import { getProfileStatCounts, profileKeys } from './profiles';

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
