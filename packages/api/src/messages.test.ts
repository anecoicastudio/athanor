import { describe, expect, test } from 'vitest';
import type { AthanorClient } from './client';
import { getMessagesPage, messageKeys, sendMessage, subscribeMessages } from './messages';
import { type FakeClient, makeFakeClient } from './test-support/fake-client';

const CONV = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';

const as = (c: FakeClient) => c as unknown as AthanorClient;

const message = (over: Record<string, unknown> = {}) => ({
  id: '33333333-3333-4333-8333-333333333333',
  conversation_id: CONV,
  sender_id: ME,
  kind: 'user',
  prompt_key: null,
  body: 'ciao',
  media_url: null,
  created_at: '2026-01-02T10:00:00.000Z',
  deleted_at: null,
  ...over,
});

const ops = (mods: unknown[][]) => mods.map((m) => m[0]);

describe('messageKeys', () => {
  test('thread key is scoped by conversation id', () => {
    expect(messageKeys.thread('c1')).toEqual(['messages', 'thread', 'c1']);
  });
});

describe('getMessagesPage', () => {
  test('scopes to the conversation and hides soft-deleted rows', async () => {
    const client = makeFakeClient();
    await getMessagesPage(as(client), { conversationId: CONV });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.table).toBe('messages');
    expect(client.calls[0]?.filters).toContainEqual(['eq', 'conversation_id', CONV]);
    expect(client.calls[0]?.filters).toContainEqual(['is', 'deleted_at', null]);
  });

  test('paginates by keyset, never by offset (rule #9)', async () => {
    const client = makeFakeClient();
    await getMessagesPage(as(client), {
      conversationId: CONV,
      cursor: { created_at: '2026-01-02T10:00:00.000Z', id: 'm9' },
      limit: 2,
    });

    const call = client.calls[0];
    expect(call?.filters).toContainEqual([
      'or',
      'created_at.lt.2026-01-02T10:00:00.000Z,and(created_at.eq.2026-01-02T10:00:00.000Z,id.lt.m9)',
    ]);
    expect(ops(call?.modifiers ?? [])).not.toContain('range');
    expect(call?.modifiers).toContainEqual(['order', 'created_at', { ascending: false }]);
    expect(call?.modifiers).toContainEqual(['order', 'id', { ascending: false }]);
    expect(call?.modifiers).toContainEqual(['limit', 2]);
  });

  test('a full page hands back the last row as the next cursor', async () => {
    const older = message({
      id: '44444444-4444-4444-8444-444444444444',
      created_at: '2026-01-01T09:00:00.000Z',
    });
    const client = makeFakeClient({ 'messages.select': [{ data: [message(), older] }] });

    const page = await getMessagesPage(as(client), { conversationId: CONV, limit: 2 });

    expect(page.messages).toHaveLength(2);
    expect(page.nextCursor).toEqual({ created_at: older.created_at, id: older.id });
  });

  test('a short page ends the walk', async () => {
    const client = makeFakeClient({ 'messages.select': [{ data: [message()] }] });

    const page = await getMessagesPage(as(client), { conversationId: CONV, limit: 2 });

    expect(page.nextCursor).toBeNull();
  });

  test('a blocked thread reads as empty — no client-side block filter, the server predicate decides', async () => {
    // athanor.not_blocked hides the rows in BOTH directions (m9_blocks_and_not_blocked.sql),
    // so the reader must neither reproduce nor second-guess it.
    const client = makeFakeClient({ 'messages.select': [{ data: [] }] });

    const page = await getMessagesPage(as(client), { conversationId: CONV });

    expect(page).toEqual({ messages: [], nextCursor: null });
    const cols = client.calls[0]?.filters.flat();
    expect(cols).not.toContain('blocker_id');
    expect(cols).not.toContain('blocked_id');
  });

  test('surfaces a database error instead of an empty page', async () => {
    const client = makeFakeClient({
      'messages.select': [{ error: { message: 'permission denied' } }],
    });

    await expect(getMessagesPage(as(client), { conversationId: CONV })).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('sendMessage', () => {
  test('rejects a blank body before touching the database', async () => {
    const client = makeFakeClient();

    await expect(
      sendMessage(as(client), { conversationId: CONV, senderId: ME, body: '   ' }),
    ).rejects.toThrow();
    expect(client.calls).toEqual([]);
  });

  test('rejects an over-long body and a non-uuid conversation before touching the database', async () => {
    const client = makeFakeClient();

    await expect(
      sendMessage(as(client), { conversationId: CONV, senderId: ME, body: 'x'.repeat(4001) }),
    ).rejects.toThrow();
    await expect(
      sendMessage(as(client), { conversationId: 'nope', senderId: ME, body: 'ciao' }),
    ).rejects.toThrow();
    expect(client.calls).toEqual([]);
  });

  test('sends the trimmed body, pins kind, and never smuggles server-owned columns', async () => {
    const client = makeFakeClient({ 'messages.insert': [{ data: [message()] }] });

    await sendMessage(as(client), {
      conversationId: CONV,
      senderId: ME,
      body: '  ciao  ',
      // a caller trying to pin server-owned state through the boundary
      id: 'forged',
      kind: 'system',
      created_at: '1999-01-01T00:00:00.000Z',
      deleted_at: '1999-01-01T00:00:00.000Z',
    } as Parameters<typeof sendMessage>[1]);

    const values = client.calls[0]?.values as Record<string, unknown>;
    expect(values.body).toBe('ciao');
    expect(values.kind).toBe('user');
    expect(values.sender_id).toBe(ME);
    expect(Object.keys(values).sort()).toEqual(['body', 'conversation_id', 'kind', 'sender_id']);
  });

  test('sender_id is the session identity the caller was handed, not a free-text field', async () => {
    const client = makeFakeClient({ 'messages.insert': [{ data: [message()] }] });

    await sendMessage(as(client), { conversationId: CONV, senderId: ME, body: 'ciao' });

    // RLS re-checks sender_id = auth.uid(); a client that rewrote it would only earn a 403,
    // so the value must travel through untouched.
    expect((client.calls[0]?.values as Record<string, unknown>).sender_id).toBe(ME);
    expect(client.calls[0]?.op).toBe('insert');
  });

  test('surfaces an insert error', async () => {
    const client = makeFakeClient({
      'messages.insert': [{ error: { message: 'new row violates row-level security' } }],
    });

    await expect(
      sendMessage(as(client), { conversationId: CONV, senderId: ME, body: 'ciao' }),
    ).rejects.toThrow(/row-level security/);
  });

  test('surfaces the PGRST116 an insert returning no row produces', async () => {
    const client = makeFakeClient({ 'messages.insert': [{ data: [] }] });

    await expect(
      sendMessage(as(client), { conversationId: CONV, senderId: ME, body: 'ciao' }),
    ).rejects.toThrow();
  });
});

describe('subscribeMessages', () => {
  test('listens for inserts in one conversation and the cleanup really removes the channel', async () => {
    const client = makeFakeClient();

    const unsubscribe = subscribeMessages(as(client), CONV, () => {});

    expect(client.channels).toHaveLength(1);
    expect(client.channels[0]?.subscribed).toBe(true);
    const [event, config] = client.channels[0]?.events[0] ?? [];
    expect(event).toBe('postgres_changes');
    expect(config).toMatchObject({
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `conversation_id=eq.${CONV}`,
    });

    expect(client.channels[0]?.removed).toBe(false);
    unsubscribe();
    expect(client.channels[0]?.removed).toBe(true);
  });

  test('hands the parsed row to the caller', async () => {
    const client = makeFakeClient();
    const seen: unknown[] = [];
    subscribeMessages(as(client), CONV, (m) => seen.push(m));

    const handler = client.channels[0]?.events[0]?.[2] as (payload: unknown) => void;
    handler({ eventType: 'INSERT', new: message() });

    expect(seen).toEqual([message()]);
  });

  test('a malformed realtime payload never reaches the caller', async () => {
    const client = makeFakeClient();
    const seen: unknown[] = [];
    subscribeMessages(as(client), CONV, (m) => seen.push(m));

    const handler = client.channels[0]?.events[0]?.[2] as (payload: unknown) => void;
    handler({ eventType: 'INSERT', new: { id: 'not-a-uuid', kind: 'shout' } });

    expect(seen).toEqual([]);
  });

  test('two subscribers get their own channel topic', async () => {
    const client = makeFakeClient();

    subscribeMessages(as(client), CONV, () => {});
    subscribeMessages(as(client), CONV, () => {});

    expect(client.channels).toHaveLength(2);
    expect(client.channels[0]?.name).not.toBe(client.channels[1]?.name);
  });
});
