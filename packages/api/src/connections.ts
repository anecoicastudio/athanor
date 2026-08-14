import { CONNECTION_BOOST_MAX_PEERS } from '@athanor/core';
import {
  type ConnectionListItem,
  connectionListItem,
  type ConnectionRequestListItem,
  connectionRequestListItem,
  connectionRequestRow,
  type ConnectionState,
} from '@athanor/schemas';
import type { AthanorClient } from './client';
import { keysetFilter, nextCursorOf } from './pagination';
import { channelTopic } from './realtime';

export const connectionKeys = {
  all: ['connections'] as const,
  incoming: () => [...connectionKeys.all, 'incoming'] as const,
  list: (search?: string) => [...connectionKeys.all, 'list', search ?? ''] as const,
  status: (peerId: string) => [...connectionKeys.all, 'status', peerId] as const,
};

const PAGE_SIZE = 20;

// ── incoming requests inbox (Richieste) ───────────────────────────────────────
/** Opaque keyset cursor — the last (created_at, id) seen. Never an offset (rule #9). */
export type RequestCursor = { created_at: string; id: string };
export type IncomingRequestsPage = {
  items: ConnectionRequestListItem[];
  nextCursor: RequestCursor | null;
};

const REQ_SELECT =
  'id, requester_id, created_at, ' +
  'requester:profiles!connection_requests_requester_id_fkey(handle, display_name, avatar_path)';

/**
 * One page of the caller's incoming pending requests, newest first by the (created_at, id)
 * keyset. RLS already scopes to pending rows the caller is party to; the explicit
 * addressee/status filters narrow it to the inbox.
 */
export async function getIncomingRequestsPage(
  client: AthanorClient,
  opts: { cursor?: RequestCursor | null; limit?: number } = {},
): Promise<IncomingRequestsPage> {
  const myId = (await client.auth.getUser()).data.user?.id;
  if (!myId) return { items: [], nextCursor: null };
  const limit = opts.limit ?? PAGE_SIZE;
  let query = client
    .from('connection_requests')
    .select(REQ_SELECT)
    .eq('addressee_id', myId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (opts.cursor) {
    const { created_at, id } = opts.cursor;
    query = query.or(keysetFilter('created_at', 'id', created_at, id, 'lt'));
  }

  const { data, error } = await query;
  if (error) throw error;
  const items = (data ?? []).map((r) => {
    const row = connectionRequestRow.parse(r);
    return connectionRequestListItem.parse({
      id: row.id,
      peerId: row.requester_id,
      peerHandle: row.requester?.handle ?? null,
      peerDisplayName: row.requester?.display_name ?? null,
      peerAvatarPath: row.requester?.avatar_path ?? null,
      createdAt: row.created_at,
    });
  });
  const nextCursor = nextCursorOf(items, limit, (last) => ({
    created_at: last.createdAt,
    id: last.id,
  }));
  return { items, nextCursor };
}

// ── established connections list (Connessioni), searchable ─────────────────────
export type ConnectionCursor = { created_at: string; id: string };
export type ConnectionsPage = {
  items: ConnectionListItem[];
  nextCursor: ConnectionCursor | null;
};

/**
 * One page of the caller's connections, optional name search, keyset on (created_at, id)
 * desc (rule #9). Resolution of the peer + handle + the ilike filter happen server-side in
 * search_connections (SECURITY INVOKER → RLS still scopes to the caller's own connections).
 */
export async function getConnectionsPage(
  client: AthanorClient,
  opts: { search?: string; cursor?: ConnectionCursor | null; limit?: number } = {},
): Promise<ConnectionsPage> {
  const limit = opts.limit ?? PAGE_SIZE;
  const { data, error } = await client.rpc('search_connections', {
    p_query: opts.search ?? '',
    p_limit: limit,
    ...(opts.cursor
      ? { p_cursor_created_at: opts.cursor.created_at, p_cursor_id: opts.cursor.id }
      : {}),
  });
  if (error) throw error;
  const items = (data ?? []).map((row) =>
    connectionListItem.parse({
      id: row.connection_id,
      peerId: row.peer_id,
      peerHandle: row.peer_handle,
      peerDisplayName: row.peer_display_name,
      peerAvatarPath: row.peer_avatar_path,
      createdAt: row.created_at,
    }),
  );
  const nextCursor = nextCursorOf(items, limit, (last) => ({
    created_at: last.createdAt,
    id: last.id,
  }));
  return { items, nextCursor };
}

// ── peer snapshot for the feed boost (#152) ────────────────────────────────────
/**
 * First-degree peer ids for the feed's light connection boost: most recent edges
 * first, capped at CONNECTION_BOOST_MAX_PEERS (bounds the `in.(...)` filter the
 * boosted stream builds). RLS scopes `connections` to rows the caller is party to.
 * Plumbing only — the boost weight and merge live in `@athanor/core` (feed/boost).
 */
export async function getConnectionPeerIds(client: AthanorClient): Promise<string[]> {
  const myId = (await client.auth.getUser()).data.user?.id;
  if (!myId) return [];
  const { data, error } = await client
    .from('connections')
    .select('profile_a, profile_b')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(CONNECTION_BOOST_MAX_PEERS);
  if (error) throw error;
  return (data ?? []).map((r) => (r.profile_a === myId ? r.profile_b : r.profile_a));
}

// ── button state for a peer (drives <ConnectButton>) ───────────────────────────
export type ConnectionStatusResult = { state: ConnectionState; requestId: string | null };

/**
 * Derive the relationship with `peerId`: connected (from connections), pending-out /
 * pending-in (from a visible pending request — RLS only returns pending rows involving the
 * caller), or none. `requestId` is set for pending-in so the inbox can accept/decline.
 */
export async function getConnectionStatus(
  client: AthanorClient,
  peerId: string,
): Promise<ConnectionStatusResult> {
  const myId = (await client.auth.getUser()).data.user?.id;
  if (!myId) return { state: 'none', requestId: null };

  const a = myId < peerId ? myId : peerId;
  const b = myId < peerId ? peerId : myId;
  const { data: conn, error: connErr } = await client
    .from('connections')
    .select('id')
    .eq('profile_a', a)
    .eq('profile_b', b)
    .maybeSingle();
  if (connErr) throw connErr;
  if (conn) return { state: 'connected', requestId: null };

  const { data: reqs, error: reqErr } = await client
    .from('connection_requests')
    .select('id, requester_id, addressee_id')
    .or(
      `and(requester_id.eq.${myId},addressee_id.eq.${peerId}),` +
        `and(requester_id.eq.${peerId},addressee_id.eq.${myId})`,
    )
    .limit(1);
  if (reqErr) throw reqErr;
  const r = (reqs ?? [])[0] as { id: string; requester_id: string } | undefined;
  if (!r) return { state: 'none', requestId: null };
  return r.requester_id === myId
    ? { state: 'pending-out', requestId: r.id }
    : { state: 'pending-in', requestId: r.id };
}

// ── mutations ──────────────────────────────────────────────────────────────────
/** Requester sends a pending request to `addresseeId`. */
export async function sendConnection(client: AthanorClient, addresseeId: string): Promise<void> {
  const myId = (await client.auth.getUser()).data.user?.id;
  if (!myId) throw new Error('not authenticated');
  const { error } = await client
    .from('connection_requests')
    .insert({ requester_id: myId, addressee_id: addresseeId });
  if (error) throw error;
}

/** Requester withdraws their own pending request (silent; same outcome as a decline). */
export async function cancelConnection(client: AthanorClient, requestId: string): Promise<void> {
  const { error } = await client.from('connection_requests').delete().eq('id', requestId);
  if (error) throw error;
}

/**
 * Addressee accepts/declines via the DEFINER RPC (not a client UPDATE — the post-transition
 * row leaves the pending-only SELECT scope, so a direct update's RETURNING would fail).
 */
export async function respondToConnection(
  client: AthanorClient,
  requestId: string,
  accept: boolean,
): Promise<void> {
  const { error } = await client.rpc('respond_to_connection', {
    p_request_id: requestId,
    p_accept: accept,
  });
  if (error) throw error;
}

/**
 * Subscribe to changes on the caller's connection requests (realtime inbox). RLS scopes the
 * stream to pending rows the caller is party to. Returns a cleanup fn — unsubscribe on unmount.
 */
export function subscribeIncomingConnections(
  client: AthanorClient,
  onChange: () => void,
): () => void {
  const channel = client
    .channel(channelTopic('connection_requests:mine'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'connection_requests' }, () =>
      onChange(),
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
