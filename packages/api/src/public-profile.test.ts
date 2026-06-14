import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import { getPublicProfileByHandle, publicProfileKeys } from './public-profile';

type Row = Record<string, unknown> | null;

/** Per-table thenable stub: from('profiles'|'dreams'|'dream_milestones') resolves to the
 *  configured row(s). maybeSingle() → { data: single }; awaiting a list chain → { data: list }. */
function makeClient(opts: { profile: Row; dream: Row; milestones: Row[] }) {
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const single = table === 'profiles' ? opts.profile : table === 'dreams' ? opts.dream : null;
      for (const m of ['select', 'eq', 'is', 'order']) chain[m] = () => chain;
      chain.maybeSingle = async () => ({ data: single, error: null });
      chain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
        resolve({ data: table === 'dream_milestones' ? opts.milestones : single, error: null });
      return chain;
    },
  } as unknown as AthanorClient;
  return client;
}

describe('public-profile api', () => {
  it('key factory shape', () => {
    expect(publicProfileKeys.detail('sole')).toEqual(['publicProfile', 'detail', 'sole']);
  });

  it('returns null when no public profile row resolves', async () => {
    const client = makeClient({ profile: null, dream: null, milestones: [] });
    expect(await getPublicProfileByHandle(client, 'ghost')).toBeNull();
  });

  it('blanks bio when the bio section is not public', async () => {
    const client = makeClient({
      profile: { id: 'p1', handle: 'sole', bio: 'secret', visibility: { dream: 'public' } },
      dream: { id: 'd1', text: 'Aprire uno studio' },
      milestones: [{ id: 'm1', body: 'Un logo', status: 'done' }],
    });
    const res = await getPublicProfileByHandle(client, 'sole');
    expect(res?.bio).toBeNull();
    expect(res?.dream?.text).toBe('Aprire uno studio');
    expect(res?.dream?.milestones).toHaveLength(1);
  });

  it('keeps bio when the bio section is public and dream is null when RLS returns no dream', async () => {
    const client = makeClient({
      profile: { id: 'p1', handle: 'sole', bio: 'Designer', visibility: { bio: 'public' } },
      dream: null,
      milestones: [],
    });
    const res = await getPublicProfileByHandle(client, 'sole');
    expect(res?.bio).toBe('Designer');
    expect(res?.dream).toBeNull();
  });
});
