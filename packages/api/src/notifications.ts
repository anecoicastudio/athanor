import { type Notification, notificationSchema } from '@athanor/schemas';
import type { AthanorClient } from './client';
import { keysetFilter, nextCursorOf } from './pagination';
import { channelTopic } from './realtime';

// Rows are written ONLY by the `notification-fan-out` edge fn (service role) — see
// supabase/functions/notification-fan-out/. TODO(M9-fanout): that fn + its DB-trigger wiring from
// source tables is deploy-deferred, so this list is empty (honest empty state) until producers land.
const PAGE = 20;

export type NotifCursor = { createdAt: string; id: string };

export const notifKeys = {
  all: ['notifications'] as const,
  list: (cursor?: string) => [...notifKeys.all, 'list', cursor ?? 'head'] as const,
  unreadPresence: () => [...notifKeys.all, 'unread'] as const, // boolean dot — NEVER a count (rule #3)
  prefs: () => [...notifKeys.all, 'prefs'] as const,
};

const COLUMNS =
  'id, recipient_id, type, template_key, params, entity_ref, read_at, created_at, updated_at';

/**
 * The caller's notifications, keyset-paginated (created_at desc, id desc) — never offset (rule #9).
 * RLS scopes rows to recipient_id = auth.uid(). Returns the next cursor (object form, like listBlocked)
 * when a full page came back.
 */
export async function listNotifications(
  client: AthanorClient,
  cursor?: NotifCursor,
): Promise<{ items: Notification[]; nextCursor: NotifCursor | null }> {
  let q = client
    .from('notifications')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE);
  if (cursor) {
    q = q.or(keysetFilter('created_at', 'id', cursor.createdAt, cursor.id, 'lt'));
  }
  const { data, error } = await q;
  if (error) throw error;
  const items = (data ?? []).map((r) => notificationSchema.parse(r));
  const nextCursor = nextCursorOf(items, PAGE, (last) => ({
    createdAt: last.created_at,
    id: last.id,
  }));
  return { items, nextCursor };
}

/** Mark one notification read (on row tap). Column grant limits the write to read_at. */
export async function markRead(client: AthanorClient, id: string): Promise<void> {
  const { error } = await client
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null);
  if (error) throw error;
}

/** Mark all own unread notifications read («Segna lette»). RLS scopes to own rows; the explicit
 *  recipient_id filter is defensive (RLS + grant already restrict, but make the intent explicit). */
export async function markAllRead(client: AthanorClient): Promise<void> {
  const { data: auth } = await client.auth.getUser();
  const me = auth.user?.id;
  if (!me) throw new Error('not authenticated');
  const { error } = await client
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', me)
    .is('read_at', null);
  if (error) throw error;
}

/** Boolean presence for the bell dot — selects a single unread id, never a count (rule #3). */
export async function unreadPresence(client: AthanorClient): Promise<boolean> {
  const { data, error } = await client
    .from('notifications')
    .select('id')
    .is('read_at', null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data != null;
}

/**
 * Realtime: new rows + read_at flips for the caller. RLS scopes the stream to
 * recipient_id = auth.uid() (no client filter needed). Returns a cleanup fn — unsubscribe on unmount.
 */
export function subscribeNotifications(client: AthanorClient, onChange: () => void): () => void {
  const channel = client
    .channel(channelTopic('notifications:mine'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () =>
      onChange(),
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

export type { Notification };
