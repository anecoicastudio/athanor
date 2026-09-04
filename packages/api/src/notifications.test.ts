import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import {
  listNotifications,
  markAllRead,
  markRead,
  notifKeys,
  subscribeNotifications,
  unreadPresence,
} from './notifications';
import { type FakeClient, makeFakeClient } from './test-support/fake-client';

const ME = '11111111-1111-4111-8111-111111111111';
const NOTIF = '22222222-2222-4222-8222-222222222222';

const as = (c: FakeClient) => c as unknown as AthanorClient;

const session = () => [
  { data: { user: { id: ME } }, error: null },
  { data: { user: { id: ME } }, error: null },
];

const notification = (over: Record<string, unknown> = {}) => ({
  id: NOTIF,
  recipient_id: ME,
  type: 'moment',
  template_key: 'moment.new',
  params: {},
  entity_ref: { kind: 'momento', id: 'm1' },
  read_at: null,
  created_at: '2026-01-02T10:00:00.000Z',
  updated_at: '2026-01-02T10:00:00.000Z',
  ...over,
});

const ops = (rows: unknown[][]) => rows.map((r) => r[0]);

describe('notifKeys', () => {
  it('namespaces all keys under "notifications"', () => {
    expect(notifKeys.all).toEqual(['notifications']);
    expect(notifKeys.list()).toEqual(['notifications', 'list', 'head']);
    expect(notifKeys.list('cur')).toEqual(['notifications', 'list', 'cur']);
    expect(notifKeys.unreadPresence()).toEqual(['notifications', 'unread']);
    expect(notifKeys.prefs()).toEqual(['notifications', 'prefs']);
  });
});

describe('listNotifications', () => {
  it('paginates by keyset, never by offset (rule #9)', async () => {
    const client = makeFakeClient();

    await listNotifications(as(client), { createdAt: '2026-01-02T10:00:00.000Z', id: NOTIF });

    const call = client.calls[0];
    expect(call?.table).toBe('notifications');
    expect(call?.filters).toContainEqual([
      'or',
      `created_at.lt.2026-01-02T10:00:00.000Z,and(created_at.eq.2026-01-02T10:00:00.000Z,id.lt.${NOTIF})`,
    ]);
    expect(ops(call?.modifiers ?? [])).not.toContain('range');
    expect(call?.modifiers).toContainEqual(['order', 'created_at', { ascending: false }]);
    expect(call?.modifiers).toContainEqual(['order', 'id', { ascending: false }]);
  });

  it('a full page hands back the last row as the next cursor', async () => {
    const older = notification({
      id: '33333333-3333-4333-8333-333333333333',
      created_at: '2026-01-01T09:00:00.000Z',
    });
    const rows = Array.from({ length: 19 }, (_, i) =>
      notification({ id: `${(i + 16).toString(16).padStart(8, '0')}-4444-4444-8444-444444444444` }),
    );
    const client = makeFakeClient({ 'notifications.select': [{ data: [...rows, older] }] });

    const page = await listNotifications(as(client));

    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).toEqual({ createdAt: older.created_at, id: older.id });
  });

  it('a short page ends the walk', async () => {
    const client = makeFakeClient({ 'notifications.select': [{ data: [notification()] }] });

    const page = await listNotifications(as(client));

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('surfaces a database error instead of an empty inbox', async () => {
    const client = makeFakeClient({
      'notifications.select': [{ error: { message: 'permission denied' } }],
    });

    await expect(listNotifications(as(client))).rejects.toThrow(/permission denied/);
  });
});

describe('markRead', () => {
  it('writes read_at and nothing else, scoped to that one still-unread row', async () => {
    const client = makeFakeClient();

    await markRead(as(client), NOTIF);

    const call = client.calls[0];
    expect(call?.op).toBe('update');
    expect(Object.keys(call?.values as object)).toEqual(['read_at']);
    expect(Number.isNaN(Date.parse((call?.values as { read_at: string }).read_at))).toBe(false);
    expect(call?.filters).toContainEqual(['eq', 'id', NOTIF]);
    expect(call?.filters).toContainEqual(['is', 'read_at', null]);
  });

  it('surfaces an update error', async () => {
    const client = makeFakeClient({
      'notifications.update': [{ error: { message: 'permission denied' } }],
    });

    await expect(markRead(as(client), NOTIF)).rejects.toThrow(/permission denied/);
  });
});

describe('markAllRead', () => {
  it('takes the recipient from the session, never from an argument', async () => {
    const client = makeFakeClient({ 'auth.getUser': session() });

    await markAllRead(as(client));

    const call = client.calls[0];
    expect(call?.op).toBe('update');
    expect(call?.filters).toContainEqual(['eq', 'recipient_id', ME]);
    expect(call?.filters).toContainEqual(['is', 'read_at', null]);
    expect(Object.keys(call?.values as object)).toEqual(['read_at']);
  });

  it('issues no unscoped update when there is no session', async () => {
    const client = makeFakeClient({ 'auth.getUser': [{ data: { user: null }, error: null }] });

    await markAllRead(as(client)).catch(() => {});

    expect(client.calls).toEqual([]);
  });

  it('surfaces an update error', async () => {
    const client = makeFakeClient({
      'auth.getUser': session(),
      'notifications.update': [{ error: { message: 'boom' } }],
    });

    await expect(markAllRead(as(client))).rejects.toThrow(/boom/);
  });
});

describe('unreadPresence', () => {
  it('answers presence with one row, never a count (rule #3)', async () => {
    const client = makeFakeClient({ 'notifications.select': [{ data: [{ id: NOTIF }] }] });

    await expect(unreadPresence(as(client))).resolves.toBe(true);
    const call = client.calls[0];
    expect(call?.filters).toContainEqual(['is', 'read_at', null]);
    expect(call?.modifiers).toContainEqual(['limit', 1]);
    expect(call?.options).toBeUndefined();
  });

  it('is false — not an error — when nothing is unread', async () => {
    const client = makeFakeClient({ 'notifications.select': [{ data: [] }] });

    await expect(unreadPresence(as(client))).resolves.toBe(false);
    expect(client.calls[0]?.terminal).toBe('maybeSingle');
  });

  it('surfaces a database error', async () => {
    const client = makeFakeClient({ 'notifications.select': [{ error: { message: 'boom' } }] });

    await expect(unreadPresence(as(client))).rejects.toThrow(/boom/);
  });
});

describe('subscribeNotifications', () => {
  it('subscribes without a client filter and the cleanup really removes the channel', () => {
    const client = makeFakeClient();

    const unsubscribe = subscribeNotifications(as(client), () => {});

    expect(client.channels).toHaveLength(1);
    expect(client.channels[0]?.subscribed).toBe(true);
    const [event, config] = client.channels[0]?.events[0] ?? [];
    expect(event).toBe('postgres_changes');
    expect(config).toMatchObject({ schema: 'public', table: 'notifications' });
    // RLS scopes the stream to recipient_id = auth.uid(); a client filter would be a second copy.
    expect(config).not.toHaveProperty('filter');

    expect(client.channels[0]?.removed).toBe(false);
    unsubscribe();
    expect(client.channels[0]?.removed).toBe(true);
  });

  it('wakes the bell for a new notification and for a read_at flip', () => {
    const client = makeFakeClient();
    let changes = 0;
    subscribeNotifications(as(client), () => {
      changes += 1;
    });

    const handler = client.channels[0]?.events[0]?.[2] as (payload: unknown) => void;
    handler({ eventType: 'INSERT', new: notification() });
    handler({ eventType: 'UPDATE', new: notification({ read_at: '2026-01-02T11:00:00.000Z' }) });

    expect(changes).toBe(2);
  });

  it('two subscribers get their own channel topic', () => {
    const client = makeFakeClient();

    subscribeNotifications(as(client), () => {});
    subscribeNotifications(as(client), () => {});

    expect(client.channels).toHaveLength(2);
    expect(client.channels[0]?.name).not.toBe(client.channels[1]?.name);
  });
});
