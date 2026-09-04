import { describe, expect, it, vi } from 'vitest';
import type { AthanorClient } from './client';
import { asClient, DB_DOWN, makeFakeClient } from './test-support/fake-client';
import { getPublicProfileByHandle, listPublicHandles } from './public-profile';

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

// #251 — the shell fields: the name passes through, the avatar key is exchanged for a
// SIGNED url (private bucket; the anon storage policy authorises the signing).
describe('getPublicProfileByHandle — shell name + signed avatar', () => {
  const KEY = `${PROFILE_ID}/${PROFILE_ID}.jpg`;
  const SIGNED = `https://x.supabase.co/storage/v1/object/sign/avatars/${KEY}?token=t`;

  it('signs the avatar key and carries name + url', async () => {
    const fake = makeFakeClient({
      'profiles.select': [
        { data: { id: PROFILE_ID, handle: 'lucia', display_name: 'Lucia Riva', avatar_path: KEY } },
      ],
      'storage.avatars.createSignedUrls': [{ data: [{ path: KEY, signedUrl: SIGNED }] }],
    });
    await expect(getPublicProfileByHandle(asClient(fake), 'lucia')).resolves.toMatchObject({
      handle: 'lucia',
      displayName: 'Lucia Riva',
      avatarUrl: SIGNED,
    });
  });

  it('never signs when there is no avatar — no storage round-trip for an initials render', async () => {
    const fake = makeFakeClient({
      'profiles.select': [
        { data: { id: PROFILE_ID, handle: 'lucia', display_name: null, avatar_path: null } },
      ],
    });
    await expect(getPublicProfileByHandle(asClient(fake), 'lucia')).resolves.toMatchObject({
      displayName: null,
      avatarUrl: null,
    });
    expect(fake.calls.some((c) => c.table.startsWith('storage.'))).toBe(false);
  });

  it('a key the signing response omits degrades to null (initials), not a crash', async () => {
    const fake = makeFakeClient({
      'profiles.select': [
        { data: { id: PROFILE_ID, handle: 'lucia', display_name: 'Lucia Riva', avatar_path: KEY } },
      ],
      'storage.avatars.createSignedUrls': [{ data: [] }],
    });
    await expect(getPublicProfileByHandle(asClient(fake), 'lucia')).resolves.toMatchObject({
      displayName: 'Lucia Riva',
      avatarUrl: null,
    });
  });

  it('rethrows when the signing CALL fails — an infra fault must not publish a photoless page', async () => {
    const fake = makeFakeClient({
      'profiles.select': [
        { data: { id: PROFILE_ID, handle: 'lucia', display_name: 'Lucia Riva', avatar_path: KEY } },
      ],
      'storage.avatars.createSignedUrls': [{ error: DB_DOWN }],
    });
    await expect(getPublicProfileByHandle(asClient(fake), 'lucia')).rejects.toMatchObject({
      code: '57P01',
    });
  });
});

describe('listPublicHandles', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    id: 'p1',
    handle: 'sole',
    updated_at: '2026-08-01T10:00:00Z',
    ...over,
  });

  it('reads the bounded index, most recently changed first, keyed by (updated_at, id)', async () => {
    const fake = makeFakeClient({
      'profiles.select': [{ data: [entry(), entry({ id: 'p2', handle: 'gio_musica' })] }],
    });
    const res = await listPublicHandles(asClient(fake), { limit: 100 });
    expect(res).toEqual({
      entries: [
        { handle: 'sole', updated_at: '2026-08-01T10:00:00Z' },
        { handle: 'gio_musica', updated_at: '2026-08-01T10:00:00Z' },
      ],
      excluded: 0,
    });
    const call = fake.calls[0]!;
    expect(call.table).toBe('profiles');
    expect(call.op).toBe('select');
    expect(call.columns).toBe('id, handle, updated_at');
    expect(call.filters).toContainEqual(['not', 'handle', 'is', null]);
    // The limit is the whole point (#335): a total order, then a cap, never an offset.
    expect(call.modifiers).toEqual([
      ['order', 'updated_at', { ascending: false }],
      ['order', 'id', { ascending: false }],
      ['limit', 100],
    ]);
  });

  it('withholds a handle the route could never resolve and counts it, instead of prerendering a 404', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = makeFakeClient({
      'profiles.select': [{ data: [entry({ handle: 'Not A Handle' }), entry({ id: 'p2' })] }],
    });
    const res = await listPublicHandles(asClient(fake), { limit: 10 });
    expect(res.entries.map((e) => e.handle)).toEqual(['sole']);
    expect(res.excluded).toBe(1);
    expect(warn.mock.calls[0]![0]).toContain('p1');
    warn.mockRestore();
  });

  it('throws when the database errors — a build must not quietly prerender nothing', async () => {
    const fake = makeFakeClient({ 'profiles.select': [{ error: DB_DOWN }] });
    await expect(listPublicHandles(asClient(fake), { limit: 10 })).rejects.toEqual(DB_DOWN);
  });

  it('a null payload is an empty index, not a crash', async () => {
    const fake = makeFakeClient({ 'profiles.select': [{ data: null }] });
    await expect(listPublicHandles(asClient(fake), { limit: 10 })).resolves.toEqual({
      entries: [],
      excluded: 0,
    });
  });
});
