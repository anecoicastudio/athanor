import { describe, expect, it, vi } from 'vitest';
import { asClient, DB_DOWN, makeFakeClient } from './test-support/fake-client';
import { getPublicDreamById, listPublicDreamIds, publicDreamKeys } from './public-dream';

const DREAM_ID = '00000000-0000-0000-0000-0000000000d1';
const PROFILE_ID = '00000000-0000-0000-0000-0000000000f1';

const dreamRow = { id: DREAM_ID, text: 'Aprire uno studio', profile_id: PROFILE_ID };
const profileRow = { handle: 'sole', display_name: 'Sole', avatar_path: 'p1/a.png' };
const signedOk = {
  data: [{ path: 'p1/a.png', signedUrl: 'https://cdn.test/a.png?token=x', error: null }],
};

/** The three reads of a fully-attributed page, plus the avatar signing. */
const wholePage = (over: Record<string, unknown> = {}) =>
  makeFakeClient({
    'dreams.select': [{ data: dreamRow }],
    'profiles.select': [{ data: profileRow }],
    'dream_milestones.select': [{ data: [{ id: 'm1', body: 'Un logo', status: 'done' }] }],
    'storage.avatars.createSignedUrls': [signedOk],
    ...over,
  });

describe('public-dream api', () => {
  it('key factory shape', () => {
    expect(publicDreamKeys.detail(DREAM_ID)).toEqual(['publicDream', 'detail', DREAM_ID]);
  });

  /*
   * The route segment is user input straight off a URL. Postgres rejects a non-uuid
   * comparison with 22P02, which PostgREST surfaces as an error — so without this guard
   * /dream/<anything> is a 500 rather than a 404, and a crawler on a stale link gets a
   * server error instead of a clean not-found.
   */
  it.each(['not-a-uuid', '', '../admin', '00000000-0000-0000-0000', `${DREAM_ID} or 1=1`])(
    'returns null for the non-uuid segment %j without touching the database',
    async (segment) => {
      const fake = makeFakeClient();
      expect(await getPublicDreamById(asClient(fake), segment)).toBeNull();
      expect(fake.calls).toHaveLength(0);
    },
  );

  it('assembles the dream, its tappe and the byline', async () => {
    const fake = wholePage();
    const res = await getPublicDreamById(asClient(fake), DREAM_ID);
    expect(res).toEqual({
      id: DREAM_ID,
      text: 'Aprire uno studio',
      milestones: [{ id: 'm1', body: 'Un logo', status: 'done' }],
      author: {
        handle: 'sole',
        displayName: 'Sole',
        avatarUrl: 'https://cdn.test/a.png?token=x',
      },
    });
  });

  /*
   * Every un-publishing event — archived, soft-deleted, facet flipped back to 'members',
   * owner banned — arrives here as the same "no row", because the anon policy carries all
   * four. One 404 path, no branch to keep in step with the migrations.
   */
  it('returns null when no dream row resolves', async () => {
    const fake = makeFakeClient({ 'dreams.select': [{ data: null }] });
    expect(await getPublicDreamById(asClient(fake), DREAM_ID)).toBeNull();
    // and it stops there: no byline lookup for a dream nobody may read.
    expect(fake.calls.filter((c) => c.table === 'profiles')).toHaveLength(0);
  });

  it('filters soft-deleted and non-active rows at the query, not only at RLS', async () => {
    const fake = wholePage();
    await getPublicDreamById(asClient(fake), DREAM_ID);
    const filters = fake.calls.find((c) => c.table === 'dreams')?.filters ?? [];
    expect(filters).toContainEqual(['is', 'deleted_at', null]);
    expect(filters).toContainEqual(['eq', 'status', 'active']);
  });

  it('never returns profile_id — the byline is a handle, not an internal id', async () => {
    const fake = wholePage();
    const res = await getPublicDreamById(asClient(fake), DREAM_ID);
    expect(res).not.toHaveProperty('profile_id');
    // …and it is still selected, because the byline lookup needs it.
    expect(fake.calls.find((c) => c.table === 'dreams')?.columns).toContain('profile_id');
  });

  /*
   * Defensive, not a member-chosen state: an identity-private or banned owner hides the DREAM
   * row too (20260814151601's «CONSEQUENCE, DELIBERATE» — the anon dream policy reaches
   * profiles through an exists, under profiles' own RLS), so this fixture cannot arise from
   * the anon client. Pinned anyway: the byline must never be what fails the page.
   */
  it('leaves the author null when no profile row comes back at all', async () => {
    const fake = wholePage({ 'profiles.select': [{ data: null }] });
    const res = await getPublicDreamById(asClient(fake), DREAM_ID);
    expect(res?.author).toBeNull();
    expect(res?.text).toBe('Aprire uno studio');
  });

  it('leaves the author null when the profile row carries no handle — the reachable case', async () => {
    const fake = wholePage({
      'profiles.select': [{ data: { handle: null, display_name: 'Sole', avatar_path: null } }],
    });
    expect((await getPublicDreamById(asClient(fake), DREAM_ID))?.author).toBeNull();
  });

  it('renders a byline with neither name nor photo — initials, not a broken img', async () => {
    const fake = wholePage({
      'profiles.select': [{ data: { handle: 'sole', display_name: null, avatar_path: null } }],
    });
    const res = await getPublicDreamById(asClient(fake), DREAM_ID);
    expect(res?.author).toEqual({ handle: 'sole', displayName: null, avatarUrl: null });
    // No signing call at all when there is no key to sign.
    expect(fake.calls.filter((c) => c.table === 'storage.avatars')).toHaveLength(0);
  });

  it('degrades to no avatar when the key does not sign, rather than failing the page', async () => {
    const fake = wholePage({ 'storage.avatars.createSignedUrls': [{ data: [] }] });
    const res = await getPublicDreamById(asClient(fake), DREAM_ID);
    expect(res?.author?.avatarUrl).toBeNull();
    expect(res?.author?.handle).toBe('sole');
  });

  it('rethrows when the dream lookup fails, rather than 404-ing a real dream', async () => {
    const fake = makeFakeClient({ 'dreams.select': [{ error: DB_DOWN }] });
    await expect(getPublicDreamById(asClient(fake), DREAM_ID)).rejects.toMatchObject({
      code: '57P01',
    });
  });

  /*
   * A failed byline lookup must not degrade to an unattributed page: that reads as «this
   * member has no handle», which is a different and false statement.
   */
  it('rethrows when the byline lookup fails, rather than publishing an unattributed dream', async () => {
    const fake = wholePage({ 'profiles.select': [{ error: DB_DOWN }] });
    await expect(getPublicDreamById(asClient(fake), DREAM_ID)).rejects.toMatchObject({
      code: '57P01',
    });
  });

  it('rethrows when the signing CALL fails — a fault must not look like «no photo»', async () => {
    const fake = wholePage({ 'storage.avatars.createSignedUrls': [{ error: DB_DOWN }] });
    await expect(getPublicDreamById(asClient(fake), DREAM_ID)).rejects.toMatchObject({
      code: '57P01',
    });
  });

  it('rethrows when the tappe lookup fails, rather than publishing a dream with no tappe', async () => {
    const fake = wholePage({ 'dream_milestones.select': [{ error: DB_DOWN }] });
    await expect(getPublicDreamById(asClient(fake), DREAM_ID)).rejects.toMatchObject({
      code: '57P01',
    });
  });

  it('orders tappe by position, then created_at, then id — a total order', async () => {
    const fake = wholePage();
    await getPublicDreamById(asClient(fake), DREAM_ID);
    const modifiers = fake.calls.find((c) => c.table === 'dream_milestones')?.modifiers ?? [];
    expect(modifiers.map((m) => m[1])).toEqual(['position', 'created_at', 'id']);
  });

  it('returns an empty tappe list rather than null when the dream has none', async () => {
    const fake = wholePage({ 'dream_milestones.select': [{ data: null }] });
    expect((await getPublicDreamById(asClient(fake), DREAM_ID))?.milestones).toEqual([]);
  });
});

describe('listPublicDreamIds', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    id: DREAM_ID,
    updated_at: '2026-08-01T10:00:00Z',
    ...over,
  });

  it('reads the N most recently changed active, undeleted dreams, newest first', async () => {
    const fake = makeFakeClient({ 'dreams.select': [{ data: [entry()] }] });
    const res = await listPublicDreamIds(asClient(fake), { limit: 50 });
    expect(res).toEqual({ entries: [entry()], excluded: 0 });

    const call = fake.calls.find((c) => c.table === 'dreams');
    expect(call?.columns).toBe('id, updated_at');
    expect(call?.filters).toEqual([
      ['is', 'deleted_at', null],
      ['eq', 'status', 'active'],
    ]);
    expect(call?.modifiers).toEqual([
      ['order', 'updated_at', { ascending: false }],
      ['order', 'id', { ascending: false }],
      ['limit', 50],
    ]);
  });

  /*
   * api.md: a row the schema rejects is withheld and COUNTED, never thrown and never dropped
   * silently — one odd row must not empty the sitemap, and a silent drop is the failure that
   * looks like success.
   */
  it('withholds and counts a row the schema rejects, keeping the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = makeFakeClient({
      'dreams.select': [{ data: [entry(), entry({ id: 'not-a-uuid' })] }],
    });
    const res = await listPublicDreamIds(asClient(fake), { limit: 50 });
    expect(res.entries).toEqual([entry()]);
    expect(res.excluded).toBe(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rethrows a query failure rather than advertising an empty index', async () => {
    const fake = makeFakeClient({ 'dreams.select': [{ error: DB_DOWN }] });
    await expect(listPublicDreamIds(asClient(fake), { limit: 50 })).rejects.toMatchObject({
      code: '57P01',
    });
  });

  it('returns an empty index for an empty table', async () => {
    const fake = makeFakeClient({ 'dreams.select': [{ data: [] }] });
    expect(await listPublicDreamIds(asClient(fake), { limit: 50 })).toEqual({
      entries: [],
      excluded: 0,
    });
  });
});
