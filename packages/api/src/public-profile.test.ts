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

  it('assembles dream + tappe and never exposes bio on the anon path', async () => {
    const client = makeClient({
      // bio is not even selectable by anon (column GRANT); never returned/read.
      profile: { id: 'p1', handle: 'sole' },
      dream: { id: 'd1', text: 'Aprire uno studio' },
      milestones: [{ id: 'm1', body: 'Un logo', status: 'done' }],
    });
    const res = await getPublicProfileByHandle(client, 'sole');
    expect(res?.bio).toBeNull();
    expect(res?.dream?.text).toBe('Aprire uno studio');
    expect(res?.dream?.milestones).toHaveLength(1);
  });

  it('bio stays null even if a bio value leaks into the row; dream null when RLS returns no dream', async () => {
    const client = makeClient({
      // defense-in-depth: even if the profile row carried a bio, the read-model drops it.
      profile: { id: 'p1', handle: 'sole', bio: 'should never surface' },
      dream: null,
      milestones: [],
    });
    const res = await getPublicProfileByHandle(client, 'sole');
    expect(res?.bio).toBeNull();
    expect(res?.dream).toBeNull();
  });
});
