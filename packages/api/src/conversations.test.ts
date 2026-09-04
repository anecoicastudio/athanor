import { describe, expect, test } from 'vitest';
import type { AthanorClient } from './client';
import {
  conversationKeys,
  getConversation,
  getConversationsPage,
  getOrCreateConversation,
  markConversationRead,
  subscribeConversations,
} from './conversations';
import { type FakeClient, makeFakeClient } from './test-support/fake-client';

const ME = '11111111-1111-4111-8111-111111111111';
const PEER = '22222222-2222-4222-8222-222222222222';
const CONV = '33333333-3333-4333-8333-333333333333';

const as = (c: FakeClient) => c as unknown as AthanorClient;

const session = () => [
  { data: { user: { id: ME } }, error: null },
  { data: { user: { id: ME } }, error: null },
];

const row = (over: Record<string, unknown> = {}) => ({
  id: CONV,
  participant_a: ME,
  participant_b: PEER,
  last_message_at: '2026-01-02T10:00:00.000Z',
  last_message_preview: 'ci vediamo',
  last_message_sender_id: PEER,
  conversation_reads: [] as { last_read_at: string }[],
  a: { handle: 'me', display_name: 'Io Stessa', avatar_path: 'me/me.jpg' },
  b: { handle: 'peer', display_name: 'Peer Uno', avatar_path: 'p/p.jpg' },
  ...over,
});

const ops = (mods: unknown[][]) => mods.map((m) => m[0]);

describe('conversationKeys', () => {
  test('list + detail key shapes', () => {
    expect(conversationKeys.list()).toEqual(['conversations', 'list']);
    expect(conversationKeys.detail('abc')).toEqual(['conversations', 'detail', 'abc']);
  });
});

describe('getConversationsPage', () => {
  test('paginates by keyset, never by offset (rule #9)', async () => {
    const client = makeFakeClient({ 'auth.getUser': session() });

    await getConversationsPage(as(client), {
      cursor: { last_message_at: '2026-01-02T10:00:00.000Z', id: 'c9' },
      limit: 3,
    });

    const call = client.calls[0];
    expect(call?.table).toBe('conversations');
    expect(call?.filters).toContainEqual([
      'or',
      'last_message_at.lt.2026-01-02T10:00:00.000Z,and(last_message_at.eq.2026-01-02T10:00:00.000Z,id.lt.c9)',
    ]);
    expect(ops(call?.modifiers ?? [])).not.toContain('range');
    expect(call?.modifiers).toContainEqual(['order', 'last_message_at', { ascending: false }]);
    expect(call?.modifiers).toContainEqual(['order', 'id', { ascending: false }]);
    expect(call?.modifiers).toContainEqual(['limit', 3]);
  });

  test('resolves the peer when the caller is participant_a', async () => {
    const client = makeFakeClient({
      'auth.getUser': session(),
      'conversations.select': [{ data: [row()] }],
    });

    const page = await getConversationsPage(as(client));

    expect(page.items[0]).toMatchObject({ id: CONV, peerId: PEER, peerHandle: 'peer' });
  });

  test('resolves the peer when the caller is participant_b — the same predicate the RLS policy uses', async () => {
    const client = makeFakeClient({
      'auth.getUser': session(),
      'conversations.select': [{ data: [row({ participant_a: PEER, participant_b: ME })] }],
    });

    const page = await getConversationsPage(as(client));

    expect(page.items[0]).toMatchObject({ id: CONV, peerId: PEER, peerHandle: 'me' });
  });

  test('a full page hands back the last row as the next cursor, a short page ends the walk', async () => {
    const older = row({
      id: '44444444-4444-4444-8444-444444444444',
      last_message_at: '2026-01-01T09:00:00.000Z',
    });
    const full = makeFakeClient({
      'auth.getUser': session(),
      'conversations.select': [{ data: [row(), older] }],
    });
    const short = makeFakeClient({
      'auth.getUser': session(),
      'conversations.select': [{ data: [row()] }],
    });

    await expect(getConversationsPage(as(full), { limit: 2 })).resolves.toMatchObject({
      nextCursor: { last_message_at: older.last_message_at, id: older.id },
    });
    await expect(getConversationsPage(as(short), { limit: 2 })).resolves.toMatchObject({
      nextCursor: null,
    });
  });

  test('an RLS-nulled handle embed parses to a null peerHandle, not a throw', async () => {
    // The profiles SELECT policy can null either handle embed (e.g. a block raised after the
    // conversation row exists). The boundary parse must accept that shape.
    const client = makeFakeClient({
      'auth.getUser': session(),
      'conversations.select': [{ data: [row({ a: null, b: null })] }],
    });

    const page = await getConversationsPage(as(client));

    expect(page.items[0]).toMatchObject({ id: CONV, peerId: PEER, peerHandle: null });
  });

  test('a thread with a blocked person reads as empty in either direction', async () => {
    // athanor.not_blocked hides the conversation whichever side raised the block
    // (m9_blocks_and_not_blocked.sql), so the client adds no block filter of its own.
    const client = makeFakeClient({
      'auth.getUser': session(),
      'conversations.select': [{ data: [] }],
    });

    const page = await getConversationsPage(as(client));

    expect(page).toEqual({ items: [], nextCursor: null });
    const filtered = client.calls[0]?.filters.flat() ?? [];
    expect(filtered).not.toContain('blocker_id');
    expect(filtered).not.toContain('blocked_id');
  });

  test('surfaces a database error instead of an empty list', async () => {
    const client = makeFakeClient({
      'auth.getUser': session(),
      'conversations.select': [{ error: { message: 'permission denied' } }],
    });

    await expect(getConversationsPage(as(client))).rejects.toThrow(/permission denied/);
  });
});

describe('getConversationsPage — the derived unread (#637)', () => {
  const pageWith = async (over: Record<string, unknown>) => {
    const client = makeFakeClient({
      'auth.getUser': session(),
      'conversations.select': [{ data: [row(over)] }],
    });
    return (await getConversationsPage(as(client))).items[0];
  };

  test('the peer wrote last and I have never opened the thread — unread', async () => {
    await expect(pageWith({ conversation_reads: [] })).resolves.toMatchObject({ unread: true });
  });

  test('my cursor predates the reply — unread', async () => {
    await expect(
      pageWith({ conversation_reads: [{ last_read_at: '2026-01-02T09:00:00.000Z' }] }),
    ).resolves.toMatchObject({ unread: true });
  });

  test('my cursor is newer than the reply — read', async () => {
    await expect(
      pageWith({ conversation_reads: [{ last_read_at: '2026-01-02T11:00:00.000Z' }] }),
    ).resolves.toMatchObject({ unread: false });
  });

  test('MY OWN message never lights my own thread, cursor or no cursor', async () => {
    // The regression the last_message_sender_id column exists to prevent: bump_conversation_on_
    // message moves last_message_at on every send, mine included, so a comparison against the
    // cursor alone marks a thread unread the instant I reply to it.
    await expect(
      pageWith({ last_message_sender_id: ME, conversation_reads: [] }),
    ).resolves.toMatchObject({ unread: false });
  });

  test('a conversation carrying only ice-breakers has no sender and reads as read', async () => {
    // kind 'system'/'prompt' rows never bump, so last_message_sender_id is null on a fresh
    // momento pair. A null must not read as "someone else", or every new match arrives lit.
    await expect(
      pageWith({ last_message_sender_id: null, conversation_reads: [] }),
    ).resolves.toMatchObject({ unread: false });
  });

  test('instants are compared, not the strings that spell them', async () => {
    // Chosen so the two readings DISAGREE, which is the only kind of case that pins the choice:
    // the cursor reads 11:00+02:00 — 09:00 UTC, an hour BEFORE the 10:00Z message, so the thread
    // is unread. Compared as text, '…T11:…' sorts after '…T10:…' and the thread reads as already
    // seen. Every same-offset pair agrees and would leave a string compare looking correct.
    await expect(
      pageWith({
        last_message_at: '2026-01-02T10:00:00.000Z',
        conversation_reads: [{ last_read_at: '2026-01-02T11:00:00.000+02:00' }],
      }),
    ).resolves.toMatchObject({ unread: true });
  });

  test('the select asks for the cursor embed and the sender column', async () => {
    const client = makeFakeClient({
      'auth.getUser': session(),
      'conversations.select': [{ data: [] }],
    });
    await getConversationsPage(as(client));
    // RLS on conversation_reads is what scopes the embed to my own row, so the query carries no
    // profile filter of its own — asserting the absence keeps a "helpful" one from being added.
    expect(client.calls[0]?.columns).toContain('conversation_reads(last_read_at)');
    expect(client.calls[0]?.columns).toContain('last_message_sender_id');
    expect(client.calls[0]?.columns).not.toContain('profile_id.eq');
  });
});

describe('markConversationRead', () => {
  test('upserts the caller own cursor and lets the SERVER stamp the time', async () => {
    const client = makeFakeClient({ 'auth.getUser': session() });

    await markConversationRead(as(client), CONV);

    const call = client.calls[0];
    expect(call?.table).toBe('conversation_reads');
    expect(call?.op).toBe('upsert');
    expect(call?.values).toEqual({ conversation_id: CONV, profile_id: ME });
    // The whole point of the stamp trigger: a device clock never reaches this column.
    expect(call?.values).not.toHaveProperty('last_read_at');
    expect(call?.options).toMatchObject({ onConflict: 'profile_id,conversation_id' });
  });

  test('a signed-out race costs a cursor update, not a throw', async () => {
    const client = makeFakeClient({
      'auth.getUser': [{ data: { user: null }, error: null }],
    });

    await expect(markConversationRead(as(client), CONV)).resolves.toBeUndefined();
    expect(client.calls).toHaveLength(0);
  });

  test('surfaces a database error', async () => {
    const client = makeFakeClient({
      'auth.getUser': session(),
      'conversation_reads.upsert': [{ error: { message: 'permission denied' } }],
    });

    await expect(markConversationRead(as(client), CONV)).rejects.toThrow(/permission denied/);
  });
});

describe('getConversation', () => {
  test('returns null for a thread the caller cannot see, rather than throwing PGRST116', async () => {
    // maybeSingle(), not single(): a blocked or foreign thread is absence, not an error.
    const client = makeFakeClient({
      'auth.getUser': session(),
      'conversations.select': [{ data: [] }],
    });

    await expect(getConversation(as(client), CONV)).resolves.toBeNull();
    expect(client.calls[0]?.terminal).toBe('maybeSingle');
  });

  test('scopes to the requested id and resolves the peer', async () => {
    const client = makeFakeClient({
      'auth.getUser': session(),
      'conversations.select': [{ data: [row()] }],
    });

    await expect(getConversation(as(client), CONV)).resolves.toMatchObject({
      peerId: PEER,
      peerHandle: 'peer',
    });
    expect(client.calls[0]?.filters).toContainEqual(['eq', 'id', CONV]);
  });

  test('surfaces a database error', async () => {
    const client = makeFakeClient({
      'auth.getUser': session(),
      'conversations.select': [{ error: { message: 'boom' } }],
    });

    await expect(getConversation(as(client), CONV)).rejects.toThrow(/boom/);
  });
});

describe('getOrCreateConversation', () => {
  test('delegates the pair canonicalisation to the server rpc', async () => {
    const client = makeFakeClient({ 'rpc.get_or_create_conversation': [{ data: CONV }] });

    await expect(getOrCreateConversation(as(client), PEER)).resolves.toBe(CONV);
    expect(client.calls[0]?.op).toBe('rpc');
    expect(client.calls[0]?.columns).toBe('get_or_create_conversation');
    expect(client.calls[0]?.values).toEqual({ peer_id: PEER });
  });

  test('surfaces an rpc error', async () => {
    const client = makeFakeClient({
      'rpc.get_or_create_conversation': [{ error: { message: 'blocked' } }],
    });

    await expect(getOrCreateConversation(as(client), PEER)).rejects.toThrow(/blocked/);
  });
});

describe('subscribeConversations', () => {
  test('subscribes without a client filter and the cleanup really removes the channel', () => {
    const client = makeFakeClient();

    const unsubscribe = subscribeConversations(as(client), () => {});

    expect(client.channels).toHaveLength(1);
    expect(client.channels[0]?.subscribed).toBe(true);
    const [event, config] = client.channels[0]?.events[0] ?? [];
    expect(event).toBe('postgres_changes');
    expect(config).toMatchObject({ schema: 'public', table: 'conversations' });
    // RLS (and athanor.not_blocked inside it) scopes the stream — a client filter would be a
    // second, weaker copy of that rule.
    expect(config).not.toHaveProperty('filter');

    expect(client.channels[0]?.removed).toBe(false);
    unsubscribe();
    expect(client.channels[0]?.removed).toBe(true);
  });

  test('a new match and a last_message_at bump both wake the list', () => {
    const client = makeFakeClient();
    let changes = 0;
    subscribeConversations(as(client), () => {
      changes += 1;
    });

    const handler = client.channels[0]?.events[0]?.[2] as (payload: unknown) => void;
    handler({ eventType: 'INSERT', new: row() });
    handler({ eventType: 'UPDATE', new: row({ last_message_preview: 'nuovo' }) });

    expect(changes).toBe(2);
  });
});
