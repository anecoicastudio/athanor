import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import { asClient, DB_DOWN, makeFakeClient } from './test-support/fake-client';
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

const PROFILE_ID = '00000000-0000-0000-0000-0000000000f1';
const DREAM_ID = '00000000-0000-0000-0000-0000000000f2';

// This is the public @handle page, SSG/ISR-rendered for SEO (web.md). Each of its three reads
// has its own error arm, and none was exercised — a failure at any step would otherwise be
// indistinguishable from "this person has no dream", which is what the page then publishes.
describe('getPublicProfileByHandle — each of the three reads surfaces its failure', () => {
  it('rethrows when the profile lookup fails, rather than 404-ing a real handle', async () => {
    const fake = makeFakeClient({ 'profiles.select': [{ error: DB_DOWN }] });
    await expect(getPublicProfileByHandle(asClient(fake), 'lucia')).rejects.toMatchObject({
      code: '57P01',
    });
  });

  it('rethrows when the dream lookup fails, rather than publishing a dreamless page', async () => {
    const fake = makeFakeClient({
      'profiles.select': [{ data: { id: PROFILE_ID, handle: 'lucia' } }],
      'dreams.select': [{ error: DB_DOWN }],
    });
    await expect(getPublicProfileByHandle(asClient(fake), 'lucia')).rejects.toMatchObject({
      code: '57P01',
    });
  });

  it('rethrows when the tappe lookup fails, rather than publishing a dream with none', async () => {
    const fake = makeFakeClient({
      'profiles.select': [{ data: { id: PROFILE_ID, handle: 'lucia' } }],
      'dreams.select': [{ data: { id: DREAM_ID, text: 'Aprire uno spazio' } }],
      'dream_milestones.select': [{ error: DB_DOWN }],
    });
    await expect(getPublicProfileByHandle(asClient(fake), 'lucia')).rejects.toMatchObject({
      code: '57P01',
    });
  });

  it('treats a null tappe payload as a dream with no milestones, not a crash', async () => {
    const fake = makeFakeClient({
      'profiles.select': [{ data: { id: PROFILE_ID, handle: 'lucia' } }],
      'dreams.select': [{ data: { id: DREAM_ID, text: 'Aprire uno spazio' } }],
      'dream_milestones.select': [{ data: null }],
    });
    await expect(getPublicProfileByHandle(asClient(fake), 'lucia')).resolves.toMatchObject({
      handle: 'lucia',
      dream: { text: 'Aprire uno spazio', milestones: [] },
    });
  });
});
