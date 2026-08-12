import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import { keysetFilter } from './pagination';
import {
  createStorySegment,
  getAuthorStoryCount,
  getPersonStory,
  getStoryRail,
  getViewerStoryReaction,
  pinStoryStep,
  softDeleteStorySegment,
  storyKeys,
  subscribeNewStories,
  toggleStoryReaction,
} from './stories';
import { makeFakeClient, type FakeResult } from './test-support/fake-client';

const AUTHOR = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SEGMENT = '77777777-7777-4777-8777-777777777777';
const SEGMENT_2 = '88888888-8888-4888-8888-888888888888';

const db = (script: Record<string, FakeResult[]> = {}) => {
  const fake = makeFakeClient(script);
  return { fake, client: fake as unknown as AthanorClient };
};

const segment = (over: Record<string, unknown> = {}) => ({
  id: SEGMENT,
  author_id: AUTHOR,
  kind: 'photo',
  storage_path: `${AUTHOR}/1.jpg`,
  duration_s: null,
  caption: null,
  is_step: false,
  pinned: false,
  expires_at: '2026-01-02T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  ...over,
});

const railRow = (author: string, at: string, handle: unknown) => ({
  author_id: author,
  created_at: at,
  profiles: handle,
});

describe('storyKeys', () => {
  it('namespaces under "stories"', () => {
    expect(storyKeys.all).toEqual(['stories']);
    expect(storyKeys.rail()).toEqual(['stories', 'rail']);
    expect(storyKeys.person('p1')).toEqual(['stories', 'person', 'p1']);
    expect(storyKeys.reactions('s1')).toEqual(['stories', 'reactions', 's1']);
  });
});

describe('getStoryRail', () => {
  it('reads a bounded page of live segments — never an offset window (rule #9)', async () => {
    const { fake, client } = db({ 'story_segments.select': [{ data: [] }] });
    await getStoryRail(client);

    const call = fake.calls[0]!;
    expect(call.table).toBe('story_segments');
    expect(call.modifiers.map((m) => m[0])).not.toContain('range');
    expect(call.modifiers).toContainEqual(['order', 'created_at', { ascending: false }]);
    expect(call.modifiers.find((m) => m[0] === 'limit')).toBeDefined();
  });

  it('hides soft-deleted and expired segments', async () => {
    const before = Date.now();
    const { fake, client } = db({ 'story_segments.select': [{ data: [] }] });
    await getStoryRail(client);

    const filters = fake.calls[0]!.filters;
    expect(filters).toContainEqual(['is', 'deleted_at', null]);
    const ttl = filters.find((f) => f[0] === 'gt' && f[1] === 'expires_at');
    expect(ttl).toBeDefined();
    expect(Date.parse(String(ttl![2]))).toBeGreaterThanOrEqual(before);
  });

  it('delegates the derivation to core — one entry per author, most recent time kept', async () => {
    const { client } = db({
      'story_segments.select': [
        {
          data: [
            railRow(AUTHOR, '2026-01-03T00:00:00Z', {
              handle: 'sole',
              display_name: 'Sole Mattina',
              avatar_path: 'sole/sole.jpg',
            }),
            railRow(AUTHOR, '2026-01-02T00:00:00Z', {
              handle: 'sole',
              display_name: 'Sole Mattina',
              avatar_path: 'sole/sole.jpg',
            }),
            railRow(OTHER, '2026-01-01T00:00:00Z', {
              handle: 'luna',
              display_name: null,
              avatar_path: null,
            }),
          ],
        },
      ],
    });

    await expect(getStoryRail(client)).resolves.toEqual([
      {
        author_id: AUTHOR,
        handle: 'sole',
        display_name: 'Sole Mattina',
        avatar_path: 'sole/sole.jpg',
        latest_at: '2026-01-03T00:00:00Z',
      },
      {
        author_id: OTHER,
        handle: 'luna',
        display_name: null,
        avatar_path: null,
        latest_at: '2026-01-01T00:00:00Z',
      },
    ]);
  });

  // The window scales with the rail length rather than equalling it: the rail dedupes by
  // author, so fetching exactly as many rows as slots lets one prolific member starve it.
  it('scales the wire window with the requested rail length', async () => {
    const { fake, client } = db({ 'story_segments.select': [{ data: [] }] });
    await getStoryRail(client, 7);
    expect(fake.calls[0]!.modifiers).toContainEqual(['limit', 28]);
  });

  it('keeps the default window at 200 rows for a 50-person rail', async () => {
    const { fake, client } = db({ 'story_segments.select': [{ data: [] }] });
    await getStoryRail(client);
    expect(fake.calls[0]!.modifiers).toContainEqual(['limit', 200]);
  });

  it('always bounds the window — never unbounded, never an offset', async () => {
    const { fake, client } = db({ 'story_segments.select': [{ data: [] }] });
    await getStoryRail(client, 7);
    const mods = fake.calls[0]!.modifiers;
    expect(mods.some(([name]) => name === 'limit')).toBe(true);
    expect(mods.some(([name]) => name === 'range')).toBe(false);
  });

  it('still caps the people it returns, even if the window over-delivers', async () => {
    const { client } = db({
      'story_segments.select': [
        {
          data: [
            railRow(AUTHOR, '2026-01-03T00:00:00Z', { handle: 'sole' }),
            railRow(OTHER, '2026-01-02T00:00:00Z', { handle: 'luna' }),
            railRow(SEGMENT_2, '2026-01-01T00:00:00Z', { handle: 'stella' }),
          ],
        },
      ],
    });

    const rail = await getStoryRail(client, 2);
    expect(rail.map((p) => p.author_id)).toEqual([AUTHOR, OTHER]);
  });

  it('no rows → an empty rail, not a throw', async () => {
    const { client } = db({ 'story_segments.select': [{ data: null }] });
    await expect(getStoryRail(client)).resolves.toEqual([]);
  });

  it('surfaces a database error instead of an empty rail', async () => {
    const { client } = db({ 'story_segments.select': [{ error: { message: 'rls denied' } }] });
    await expect(getStoryRail(client)).rejects.toThrow('rls denied');
  });
});

describe('getPersonStory', () => {
  it('walks one author ascending by keyset — never by offset (rule #9)', async () => {
    const { fake, client } = db({ 'story_segments.select': [{ data: [] }] });
    await getPersonStory(client, AUTHOR, null, 30);

    const call = fake.calls[0]!;
    expect(call.filters).toContainEqual(['eq', 'author_id', AUTHOR]);
    expect(call.filters).toContainEqual(['is', 'deleted_at', null]);
    expect(call.modifiers.map((m) => m[0])).not.toContain('range');
    expect(call.modifiers).toEqual([
      ['order', 'created_at', { ascending: true }],
      ['order', 'id', { ascending: true }],
      ['limit', 30],
    ]);
  });

  it('a cursor becomes the shared forward keyset disjunction', async () => {
    const cursor = { created_at: '2026-01-01T00:00:00Z', id: SEGMENT };
    const { fake, client } = db({ 'story_segments.select': [{ data: [] }] });
    await getPersonStory(client, AUTHOR, cursor);

    expect(fake.calls[0]!.filters).toContainEqual([
      'or',
      keysetFilter('created_at', 'id', cursor.created_at, cursor.id, 'gt'),
    ]);
  });

  it('a full page hands back the last segment as the next cursor', async () => {
    const last = segment({ id: SEGMENT_2, created_at: '2026-01-02T00:00:00Z' });
    const { client } = db({ 'story_segments.select': [{ data: [segment(), last] }] });

    const page = await getPersonStory(client, AUTHOR, null, 2);
    expect(page.segments).toHaveLength(2);
    expect(page.nextCursor).toEqual({ created_at: last.created_at, id: last.id });
  });

  it('a short page ends the walk', async () => {
    const { client } = db({ 'story_segments.select': [{ data: [segment()] }] });
    await expect(getPersonStory(client, AUTHOR, null, 2)).resolves.toMatchObject({
      nextCursor: null,
    });
  });

  it('no rows → an empty story, not a throw', async () => {
    const { client } = db({ 'story_segments.select': [{ data: null }] });
    await expect(getPersonStory(client, AUTHOR)).resolves.toEqual({
      segments: [],
      nextCursor: null,
    });
  });

  it('surfaces a database error instead of an empty story', async () => {
    const { client } = db({ 'story_segments.select': [{ error: { message: 'rls denied' } }] });
    await expect(getPersonStory(client, AUTHOR)).rejects.toThrow('rls denied');
  });

  it('rejects a row the segment schema does not recognise', async () => {
    const { client } = db({ 'story_segments.select': [{ data: [{ id: 'nope' }] }] });
    await expect(getPersonStory(client, AUTHOR)).rejects.toThrow();
  });
});

describe('createStorySegment', () => {
  it('validates before touching the database', async () => {
    const { fake, client } = db();
    await expect(
      createStorySegment(client, {
        author_id: AUTHOR,
        kind: 'photo',
        storage_path: '',
        duration_s: 999,
        caption: null,
        is_step: false,
      } as never),
    ).rejects.toThrow();
    expect(fake.calls).toEqual([]);
  });

  it('sends only the client-writable columns — the TTL, pin and id stay server-owned', async () => {
    const { fake, client } = db({ 'story_segments.insert': [{ data: [segment()] }] });
    await createStorySegment(client, {
      author_id: AUTHOR,
      kind: 'photo',
      storage_path: `${AUTHOR}/1.jpg`,
      duration_s: null,
      caption: null,
      is_step: true,
    });

    const call = fake.calls[0]!;
    expect(call.op).toBe('insert');
    expect(Object.keys(call.values as object).sort()).toEqual([
      'author_id',
      'caption',
      'duration_s',
      'is_step',
      'kind',
      'storage_path',
    ]);
  });

  it('returns the parsed row the server actually wrote', async () => {
    const { client } = db({ 'story_segments.insert': [{ data: [segment({ pinned: true })] }] });
    const created = await createStorySegment(client, {
      author_id: AUTHOR,
      kind: 'photo',
      storage_path: `${AUTHOR}/1.jpg`,
      duration_s: null,
      caption: null,
      is_step: false,
    });
    expect(created).toMatchObject({ id: SEGMENT, pinned: true, expires_at: expect.any(String) });
  });

  it('throws when the insert returns no row (RLS refused it)', async () => {
    const { client } = db({ 'story_segments.insert': [{ data: [] }] });
    await expect(
      createStorySegment(client, {
        author_id: AUTHOR,
        kind: 'photo',
        storage_path: `${AUTHOR}/1.jpg`,
        duration_s: null,
        caption: null,
        is_step: false,
      }),
    ).rejects.toThrow(/rows/i);
  });

  it('never writes an aura row (rule #1)', async () => {
    const { fake, client } = db({ 'story_segments.insert': [{ data: [segment()] }] });
    await createStorySegment(client, {
      author_id: AUTHOR,
      kind: 'video',
      storage_path: `${AUTHOR}/1.mp4`,
      duration_s: 12,
      caption: null,
      is_step: false,
    });
    expect(fake.calls.every((c) => !c.table.startsWith('aura'))).toBe(true);
  });
});

describe('pinStoryStep', () => {
  it('sets pinned alone, scoped to a live segment', async () => {
    const { fake, client } = db();
    await pinStoryStep(client, SEGMENT);

    const call = fake.calls[0]!;
    expect(call.op).toBe('update');
    expect(call.values).toEqual({ pinned: true });
    expect(call.filters).toEqual([
      ['eq', 'id', SEGMENT],
      ['is', 'deleted_at', null],
    ]);
  });

  it('surfaces the policy error when the caller is not the author', async () => {
    const { client } = db({
      'story_segments.update': [{ error: { code: '42501', message: 'denied' } }],
    });
    await expect(pinStoryStep(client, SEGMENT)).rejects.toThrow('denied');
  });
});

describe('softDeleteStorySegment', () => {
  it('stamps deleted_at on a row that is still live', async () => {
    const before = Date.now();
    const { fake, client } = db();
    await softDeleteStorySegment(client, SEGMENT);

    const call = fake.calls[0]!;
    expect(call.op).toBe('update');
    expect(call.filters).toEqual([
      ['eq', 'id', SEGMENT],
      ['is', 'deleted_at', null],
    ]);
    const { deleted_at } = call.values as { deleted_at: string };
    expect(Date.parse(deleted_at)).toBeGreaterThanOrEqual(before);
    expect(Object.keys(call.values as object)).toEqual(['deleted_at']);
  });

  it('surfaces the policy error when the caller is not the author', async () => {
    const { client } = db({
      'story_segments.update': [{ error: { code: '42501', message: 'denied' } }],
    });
    await expect(softDeleteStorySegment(client, SEGMENT)).rejects.toThrow('denied');
  });
});

describe('getViewerStoryReaction', () => {
  it('reads the viewer own row only — never an aggregate (rule #3)', async () => {
    const { fake, client } = db({ 'story_reactions.select': [{ data: [{ id: SEGMENT }] }] });
    await expect(getViewerStoryReaction(client, SEGMENT, AUTHOR)).resolves.toBe(true);

    const call = fake.calls[0]!;
    expect(call.table).toBe('story_reactions');
    expect(call.columns).toBe('id');
    expect(call.terminal).toBe('maybeSingle');
    expect(call.options).toBeUndefined();
  });

  // maybeSingle() errors on >1 row, so the single-row shape cannot be left to a select
  // policy that may widen later (e.g. an author-sees-reactors surface).
  it('pins the pair explicitly rather than trusting RLS to leave one row', async () => {
    const { fake, client } = db({ 'story_reactions.select': [{ data: [] }] });
    await getViewerStoryReaction(client, SEGMENT, AUTHOR);
    expect(fake.calls[0]!.filters).toEqual([
      ['eq', 'segment_id', SEGMENT],
      ['eq', 'person_id', AUTHOR],
    ]);
  });

  it('falls back to the session uid when the caller does not supply one', async () => {
    const { fake, client } = db({ 'story_reactions.select': [{ data: [] }] });
    await getViewerStoryReaction(client, SEGMENT);
    // the shared fake resolves getUser() to prof-1
    expect(fake.calls[0]!.filters).toContainEqual(['eq', 'person_id', 'prof-1']);
  });

  it('a signed-out viewer is unlit, with no query at all', async () => {
    const { fake, client } = db({ 'auth.getUser': [{ data: { user: null }, error: null }] });
    await expect(getViewerStoryReaction(client, SEGMENT)).resolves.toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it('no row → unlit', async () => {
    const { client } = db({ 'story_reactions.select': [{ data: [] }] });
    await expect(getViewerStoryReaction(client, SEGMENT, AUTHOR)).resolves.toBe(false);
  });

  it('surfaces a database error instead of reporting unlit', async () => {
    const { client } = db({ 'story_reactions.select': [{ error: { message: 'rls denied' } }] });
    await expect(getViewerStoryReaction(client, SEGMENT, AUTHOR)).rejects.toThrow('rls denied');
  });
});

describe('toggleStoryReaction', () => {
  it('unlit → inserts the own row and reports lit', async () => {
    const { fake, client } = db({ 'story_reactions.select': [{ data: [] }] });
    await expect(toggleStoryReaction(client, SEGMENT, AUTHOR)).resolves.toBe(true);

    expect(fake.calls.map((c) => c.op)).toEqual(['select', 'insert']);
    expect(fake.calls[1]!.values).toEqual({ segment_id: SEGMENT, person_id: AUTHOR });
  });

  it('lit → deletes the own row, scoped to the pair, and reports unlit', async () => {
    const { fake, client } = db({ 'story_reactions.select': [{ data: [{ id: SEGMENT }] }] });
    await expect(toggleStoryReaction(client, SEGMENT, AUTHOR)).resolves.toBe(false);

    expect(fake.calls.map((c) => c.op)).toEqual(['select', 'delete']);
    expect(fake.calls[1]!.filters).toEqual([
      ['eq', 'segment_id', SEGMENT],
      ['eq', 'person_id', AUTHOR],
    ]);
  });

  it('never writes an aura row for the ✦ event (rule #1)', async () => {
    const { fake, client } = db({ 'story_reactions.select': [{ data: [] }] });
    await toggleStoryReaction(client, SEGMENT, AUTHOR);
    expect(fake.calls.every((c) => !c.table.startsWith('aura'))).toBe(true);
  });

  it('surfaces a failed un-tap instead of reporting unlit', async () => {
    const { client } = db({
      'story_reactions.select': [{ data: [{ id: SEGMENT }] }],
      'story_reactions.delete': [{ error: { code: '42501', message: 'denied' } }],
    });
    await expect(toggleStoryReaction(client, SEGMENT, AUTHOR)).rejects.toThrow('denied');
  });

  it('surfaces the unique-violation from a double tap', async () => {
    const { client } = db({
      'story_reactions.select': [{ data: [] }],
      'story_reactions.insert': [{ error: { code: '23505', message: 'duplicate key' } }],
    });
    await expect(toggleStoryReaction(client, SEGMENT, AUTHOR)).rejects.toThrow('duplicate key');
  });
});

describe('getAuthorStoryCount', () => {
  it('goes through the author-gated rpc, never a table count (rule #3)', async () => {
    const { fake, client } = db({ 'rpc.story_reaction_count': [{ data: 7 }] });
    await expect(getAuthorStoryCount(client, SEGMENT)).resolves.toBe(7);

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      table: 'rpc',
      columns: 'story_reaction_count',
      values: { p_segment_id: SEGMENT },
    });
    expect(fake.calls.some((c) => c.table === 'story_reactions')).toBe(false);
  });

  it('a null count reads as zero', async () => {
    const { client } = db({ 'rpc.story_reaction_count': [{ data: null }] });
    await expect(getAuthorStoryCount(client, SEGMENT)).resolves.toBe(0);
  });

  it('surfaces an rpc error instead of reporting zero', async () => {
    const { client } = db({ 'rpc.story_reaction_count': [{ error: { message: 'boom' } }] });
    await expect(getAuthorStoryCount(client, SEGMENT)).rejects.toThrow('boom');
  });
});

describe('subscribeNewStories', () => {
  it('subscribes to story_segments inserts and forwards the new row', async () => {
    const seen: unknown[] = [];
    const { fake, client } = db();
    const unsubscribe = subscribeNewStories(client, (s) => seen.push(s));

    const channel = fake.channels[0]!;
    expect(channel.subscribed).toBe(true);
    expect(channel.events[0]![0]).toBe('postgres_changes');
    expect(channel.events[0]![1]).toMatchObject({
      event: 'INSERT',
      schema: 'public',
      table: 'story_segments',
    });

    const handler = channel.events[0]![2] as (payload: unknown) => void;
    handler({ new: segment() });
    expect(seen).toEqual([segment()]);

    unsubscribe();
  });

  it('hands back a cleanup that actually removes the channel', async () => {
    const { fake, client } = db();
    const unsubscribe = subscribeNewStories(client, () => {});
    expect(fake.channels[0]!.removed).toBe(false);

    unsubscribe();
    expect(fake.channels[0]!.removed).toBe(true);
  });

  it('gives concurrent subscribers distinct channels', async () => {
    const { fake, client } = db();
    const offA = subscribeNewStories(client, () => {});
    const offB = subscribeNewStories(client, () => {});

    expect(fake.channels).toHaveLength(2);
    expect(fake.channels[0]!.name).not.toBe(fake.channels[1]!.name);

    offA();
    offB();
  });
});
