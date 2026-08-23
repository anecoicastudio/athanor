import {
  type Attendance,
  type CheckInResult,
  type Event,
  type EventCalendarFilters,
  type EventCategory,
  type EventCreate,
  type EventLiveStats,
  type EventNearby,
  type Rsvp,
  type Ticket,
  attendanceSchema,
  checkInResultSchema,
  eventCreateSchema,
  eventLiveStatsSchema,
  eventNearbySchema,
  eventSchema,
  rsvpSchema,
  ticketSchema,
} from '@athanor/schemas';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import type { AthanorClient } from './client';
import { keysetFilter, nextCursorOf } from './pagination';
import { channelTopic, sharedRoom } from './realtime';

export const eventKeys = {
  all: ['events'] as const,
  nearby: (lat: number, lng: number, radiusKm: number) =>
    [...eventKeys.all, 'nearby', lat, lng, radiusKm] as const,
  /**
   * Filters belong IN the key (rules/api.md): a changed filter set is a different cache
   * entry, so TanStack starts it at `initialPageParam: null` and the keyset cursor from
   * the previous filter set can never be carried into it (rule #9).
   */
  calendar: (filters?: EventCalendarFilters) => [...eventKeys.all, 'calendar', filters] as const,
  online: () => [...eventKeys.all, 'online'] as const,
  today: () => [...eventKeys.all, 'today'] as const,
  detail: (id: string) => [...eventKeys.all, 'detail', id] as const,
  byOrganizer: (uid: string) => [...eventKeys.all, 'organizer', uid] as const,
  rsvp: (eventId: string) => [...eventKeys.all, 'rsvp', eventId] as const,
  attendees: (eventId: string) => [...eventKeys.all, 'attendees', eventId] as const,
  liveStats: (eventId: string) => [...eventKeys.all, 'liveStats', eventId] as const,
  ticket: (eventId: string) => [...eventKeys.all, 'ticket', eventId] as const,
  seats: (eventId: string) => [...eventKeys.all, 'seats', eventId] as const,
  checkin: (eventId: string) => [...eventKeys.all, 'checkin', eventId] as const,
};

/** Columns the client reads (everything except the geography `geo` column). */
const EVENT_COLS =
  'id,organizer_id,title,category,is_online,venue,city,stream_url,starts_at,ends_at,capacity,price_cents,currency,fee_pct,is_kairos_day,is_athanor_day,cover_url,live_started_at,live_ended_at,settlement_ack_at,created_at,updated_at,deleted_at';

const PAGE_SIZE = 20;

/**
 * How long an event with no declared `ends_at` is assumed to run. `events_ends_after_starts`
 * makes `ends_at` optional, so without this an event that never declares an end would either
 * vanish at its start instant or linger on the calendar forever.
 *
 * NOTE this is deliberately the one hour the #530 ruling names, while
 * `20260813054817_live_window_sweep.sql` closes an unclosed LIVE window after four. The two
 * answer different questions — the sweep decides when a stream is over, this decides how long
 * an open-ended event stays listed — and for an online event the sweep's window keeps the row
 * visible through arm 2 regardless. An in-person open-ended event, which nothing marks live,
 * does drop off after an hour.
 */
const ASSUMED_DURATION_MS = 60 * 60 * 1000;

/**
 * How far back the scan may reach. Without a lower bound the disjunction below is not sargable
 * against `events_calendar (starts_at, id) where deleted_at is null`: the planner would walk
 * the index from the oldest event forward, discarding every finished row before it could fill
 * a page — cost growing with the table's whole history, on the hot path of Home «Oggi», Live
 * Calendario/Mappa and the feed's «Eventi» tab.
 *
 * As a top-level predicate it ANDs with the bound and restores the range start. The trade is
 * explicit: an event still under way that began more than this long ago is not listed. It also
 * caps arm 2, which is otherwise unbounded in time — a live window that is never closed
 * (`live_window_sweep` never overwrites a manually set one) would otherwise sit on every
 * calendar surface forever.
 */
const MAX_EVENT_SPAN_MS = 30 * 24 * 60 * 60 * 1000;

/** Opaque keyset cursor for the calendar (the last (starts_at, id) seen). Never an offset (rule #9). */
export type CalendarCursor = { starts_at: string; id: string };
export type CalendarPage = { events: Event[]; nextCursor: CalendarCursor | null };

/**
 * Escape the LIKE metacharacters PostgREST forwards, so a city typed into the filter
 * sheet is matched literally. `*` is PostgREST's own alias for `%` in `like`/`ilike`
 * and is substituted before Postgres sees the pattern, so a backslash cannot escape it —
 * it is dropped instead (no city name contains one).
 */
function literalIlike(value: string): string {
  return value.replace(/\*/g, '').replace(/([\\%_])/g, '\\$1');
}

/**
 * Events that have not finished — upcoming, live now, or in progress — ascending by
 * (starts_at, id), keyset, never offset. A row is kept while ANY of: it has not started;
 * `live_started_at` is set and `live_ended_at` is not; `ends_at` is still to come; or it
 * declared no `ends_at` and started within the last hour (`ASSUMED_DURATION_MS`).
 *
 * Before #530 this was `starts_at >= now`, which hid an event at the instant it began.
 * Rows that are already under way therefore sort FIRST now — soonest-`starts_at` ascending
 * puts a started event ahead of an upcoming one, which is the intent: a live event leads
 * «Oggi» and the calendar. The bound is a filter, so the (starts_at, id) keyset is unchanged.
 *
 * `filters` is appended last and stays optional so the two unfiltered call sites
 * (`TodaySection` under `eventKeys.today()`, and `useCalendarEvents`) keep their
 * behaviour byte-for-byte. Every filter is a top-level PostgREST predicate, and
 * top-level predicates AND together — so they compose with the keyset `or(...)`
 * rather than widening it.
 *
 * The date window is a pair of absolute ISO instants resolved by the caller, never a
 * preset name: this function reads the clock exactly once, for the visibility bound, and
 * `dateFrom`/`dateTo` AND with that bound instead of replacing it. A past `dateFrom`
 * therefore cannot resurrect events that already finished. The converse is deliberate too:
 * `dateFrom` is a plain `starts_at` lower bound, so a preset like «Domani» still excludes
 * an event that is live right now but started yesterday — a date filter is a question about
 * when something starts, and answering it with a row outside the window would be wrong.
 *
 * `filters` is trusted on its type: VALIDATING it is the caller's job, and the app does it
 * in `apps/native/src/lib/event-filters.ts` before the value ever reaches here. Nothing is
 * cast off a result, which is what rules/api.md's "Zod at a query boundary" governs.
 */
export async function getEventsCalendar(
  client: AthanorClient,
  cursor?: CalendarCursor | null,
  limit = PAGE_SIZE,
  filters?: EventCalendarFilters,
): Promise<CalendarPage> {
  // The visibility bound (#530). A bare `starts_at >= now` dropped every event at the
  // instant it began — the one moment it matters most — so a row stays while ANY arm holds:
  // not started yet, explicitly live, or in progress by time. `coalesce(ends_at, starts_at +
  // 1h) >= now` is split into the last two arms because PostgREST cannot add an interval in
  // a filter; both instants come from the ONE clock read this function promises.
  // Top-level predicates AND together, so this composes with the keyset `or(...)` below and
  // with the #151 date window rather than widening either.
  const now = new Date();
  const cutoff = now.toISOString();
  const graceCutoff = new Date(now.getTime() - ASSUMED_DURATION_MS).toISOString();
  const scanFloor = new Date(now.getTime() - MAX_EVENT_SPAN_MS).toISOString();
  let query = client
    .from('events')
    .select(EVENT_COLS)
    .is('deleted_at', null)
    .gte('starts_at', scanFloor)
    .or(
      `starts_at.gte.${cutoff},` +
        `and(live_started_at.not.is.null,live_ended_at.is.null),` +
        `ends_at.gte.${cutoff},` +
        `and(ends_at.is.null,starts_at.gte.${graceCutoff})`,
    )
    .order('starts_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit);

  if (filters?.category) query = query.eq('category', filters.category);
  // `events.city` is free text written by event-create's reverse geocode, so match it
  // case-insensitively but WHOLE — no implicit wildcards, or «Roma» would also pull in
  // every «Roma, RM» variant the geocoder happens to emit.
  if (filters?.city) query = query.ilike('city', literalIlike(filters.city));
  if (filters?.dateFrom) query = query.gte('starts_at', filters.dateFrom);
  if (filters?.dateTo) query = query.lte('starts_at', filters.dateTo);

  if (cursor) {
    const { starts_at, id } = cursor;
    query = query.or(keysetFilter('starts_at', 'id', starts_at, id, 'gt'));
  }

  const { data, error } = await query;
  if (error) throw error;
  const events = (data ?? []).map((row) => eventSchema.parse(row as unknown));
  const nextCursor = nextCursorOf(events, limit, (last) => ({
    starts_at: last.starts_at,
    id: last.id,
  }));
  return { events, nextCursor };
}

/**
 * Online events (is_online). The screen partitions into live-now vs upcoming
 * (presentation): live-now = live_started_at set AND live_ended_at null.
 */
export async function getEventsOnline(client: AthanorClient): Promise<Event[]> {
  const { data, error } = await client
    .from('events')
    .select(EVENT_COLS)
    .is('deleted_at', null)
    .eq('is_online', true)
    .order('starts_at', { ascending: true })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map((row) => eventSchema.parse(row as unknown));
}

/** Keyset cursor for nearby (the last (dist_meters, id) seen). */
export type NearbyCursor = { dist: number; id: string };
export type NearbyPage = { events: EventNearby[]; nextCursor: NearbyCursor | null };

/** Physical events within radiusKm of (lat,lng), nearest-first. Distance computed server-side. */
export async function getEventsNearby(
  client: AthanorClient,
  lat: number,
  lng: number,
  radiusKm = 50,
  cursor?: NearbyCursor | null,
  limit = PAGE_SIZE,
): Promise<NearbyPage> {
  const rpcArgs: {
    lat: number;
    long: number;
    radius_m?: number;
    cursor_dist?: number;
    cursor_id?: string;
    page_size?: number;
  } = {
    lat,
    long: lng,
    radius_m: radiusKm * 1000,
    page_size: limit,
  };
  if (cursor) {
    rpcArgs.cursor_dist = cursor.dist;
    rpcArgs.cursor_id = cursor.id;
  }

  const { data, error } = await client.rpc('events_nearby', rpcArgs);
  if (error) throw error;
  const events = (data ?? []).map((row) => eventNearbySchema.parse(row as unknown));
  const nextCursor = nextCursorOf(events, limit, (last) => ({
    dist: last.dist_meters,
    id: last.id,
  }));
  return { events, nextCursor };
}

/** A single event (modal detail). Null when missing or soft-deleted. */
export async function getEvent(client: AthanorClient, id: string): Promise<Event | null> {
  const { data, error } = await client
    .from('events')
    .select(EVENT_COLS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return eventSchema.parse(data);
}

/** Events an organizer owns (newest first). */
export async function getEventsByOrganizer(client: AthanorClient, uid: string): Promise<Event[]> {
  const { data, error } = await client
    .from('events')
    .select(EVENT_COLS)
    .eq('organizer_id', uid)
    .is('deleted_at', null)
    .order('starts_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map((row) => eventSchema.parse(row as unknown));
}

/**
 * Publish an event via the create_event RPC (the server builds the geography point
 * from lat/long; RLS enforces organizer = auth.uid()). Returns the new event row.
 * NEVER writes money or Aura (rule #1) — price_cents is set, but the ticket/Stripe
 * flow is the tickets-qr slice; the +30 organize award is M6 (TODO(M6)).
 */
export async function createEvent(client: AthanorClient, input: EventCreate): Promise<Event> {
  const v = eventCreateSchema.parse(input);
  const rpcArgs: {
    p_title: string;
    p_category: EventCategory;
    p_is_online: boolean;
    p_starts_at: string;
    p_venue?: string;
    p_city?: string;
    p_lat?: number;
    p_long?: number;
    p_stream_url?: string;
    p_ends_at?: string;
    p_capacity?: number;
    p_price_cents?: number;
    p_currency?: string;
    p_settlement_ack?: boolean;
  } = {
    p_title: v.title,
    p_category: v.category,
    p_is_online: v.is_online,
    p_starts_at: v.starts_at,
  };
  if (v.venue != null) rpcArgs.p_venue = v.venue;
  if (v.city != null) rpcArgs.p_city = v.city;
  if (v.lat != null) rpcArgs.p_lat = v.lat;
  if (v.long != null) rpcArgs.p_long = v.long;
  if (v.stream_url != null) rpcArgs.p_stream_url = v.stream_url;
  if (v.ends_at != null) rpcArgs.p_ends_at = v.ends_at;
  if (v.capacity != null) rpcArgs.p_capacity = v.capacity;
  if (v.price_cents !== 0) rpcArgs.p_price_cents = v.price_cents;
  if (v.currency !== 'eur') rpcArgs.p_currency = v.currency;
  // Sent only for a paid event that carries it, matching the RPC's `default false` and its own
  // `price_cents > 0` scoping. A free event has nothing to settle, so an acknowledgement on one
  // would record agreement to terms that do not apply. create_event refuses a paid event without
  // it and stamps settlement_ack_at from now(); the boolean is all the client ever says (#437).
  if (v.price_cents > 0 && v.settlement_ack) rpcArgs.p_settlement_ack = true;

  const { data: id, error } = await client.rpc('create_event', rpcArgs);
  if (error) throw error;
  const created = await getEvent(client, id);
  if (!created) throw new Error('created event not found');
  return created;
}

/** Register "Avvisami" interest in Athanor Days. Idempotent (unique nulls-not-distinct). */
export async function registerAthanorDaysInterest(
  client: AthanorClient,
  userId: string,
  edition: string | null = null,
): Promise<void> {
  const { error } = await client
    .from('athanor_days_interest')
    .upsert(
      { user_id: userId, edition },
      { onConflict: 'user_id,edition', ignoreDuplicates: true },
    );
  if (error) throw error;
}

/**
 * Upsert the viewer's RSVP for a free event. Idempotent: the unique (user_id, event_id)
 * conflict flips status — a second "Partecipo" tap is a no-op, a cancel sets
 * status='cancelled' (we keep the row, never delete — backend §2.2). NEVER writes Aura
 * (rule #1): the +15 attend award is the M6 score-engine (TODO(M6)).
 */
export async function upsertRsvp(
  client: AthanorClient,
  eventId: string,
  userId: string,
  going: boolean,
): Promise<void> {
  const { error } = await client
    .from('rsvps')
    .upsert(
      { user_id: userId, event_id: eventId, status: going ? 'going' : 'cancelled' },
      { onConflict: 'user_id,event_id' },
    );
  if (error) throw error;
}

/** The viewer's own RSVP for an event (null if they never RSVP'd). */
export async function getMyRsvp(
  client: AthanorClient,
  eventId: string,
  userId: string,
): Promise<Rsvp | null> {
  const { data, error } = await client
    .from('rsvps')
    .select('id,user_id,event_id,status,created_at,updated_at')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return rsvpSchema.parse(data);
}

/** Attendee preview for the stack: a head-count of 'going' + up to `previewLimit` earliest user_ids. */
export type AttendeePreview = { count: number; userIds: string[] };
export async function getEventAttendees(
  client: AthanorClient,
  eventId: string,
  previewLimit = 4, // 4 = the avatar-stack size on the event detail
): Promise<AttendeePreview> {
  const { count, error: countErr } = await client
    .from('rsvps')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('status', 'going');
  if (countErr) throw countErr;

  const { data, error } = await client
    .from('rsvps')
    .select('user_id')
    .eq('event_id', eventId)
    .eq('status', 'going')
    .order('created_at', { ascending: true })
    .limit(previewLimit);
  if (error) throw error;

  return {
    count: count ?? 0,
    userIds: (data ?? []).map((r) => r.user_id),
  };
}

/** One-shot read of the live flag for an online event (null if no row yet). */
export async function getEventLiveStats(
  client: AthanorClient,
  eventId: string,
): Promise<EventLiveStats | null> {
  const { data, error } = await client
    .from('event_live_stats')
    .select('event_id,is_live,updated_at')
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) throw error;
  return data ? eventLiveStatsSchema.parse(data) : null;
}

/**
 * Subscribe to the live flag for one online event (realtime INSERT/UPDATE) — backend 09 C8,
 * channel `event:{id}:live`. The flag is cron-maintained (live_window_sweep); clients never
 * write it. The listener count is presence, not a row — see subscribeEventPresence.
 * Returns a cleanup fn — callers MUST call it on unmount (rule api.md, invariant #1).
 */
export function subscribeEventLive(
  client: AthanorClient,
  eventId: string,
  onStats: (stats: EventLiveStats) => void,
): () => void {
  const channel = client
    .channel(channelTopic(`event:${eventId}:live`))
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'event_live_stats',
        filter: `event_id=eq.${eventId}`,
      },
      (payload) => {
        const parsed = eventLiveStatsSchema.safeParse(payload.new);
        if (parsed.success) onStats(parsed.data);
      },
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

type PresenceMember = {
  /** where this subscriber wants the room's size delivered */
  onCount: (count: number) => void;
  /** whether this subscriber wants its own presence counted, not just observed */
  track: boolean;
};

/**
 * Subscribe to the live listener count of one event via Realtime presence — no table, no
 * writer, no polling (#120). `onCount` receives the number of open connections in the room
 * (a person on two devices counts twice). Pass `track: true` from the listening surface
 * (event detail) to be counted; omit it to observe only (Live-tab rows).
 * Returns a cleanup fn — callers MUST call it on unmount (rule api.md, invariant #1).
 *
 * One shared room per (client, event): presence only counts members of the SAME topic, so
 * this must NOT go through channelTopic — its uniqueness suffix would put every subscriber
 * in a private room of one. sharedRoom holds the refcount (realtime.ts); the member is an
 * internal record rather than `onCount` itself, so a caller passing one stable callback
 * (a useState setter) from two places still gets two subscribers.
 */
export function subscribeEventPresence(
  client: AthanorClient,
  eventId: string,
  onCount: (count: number) => void,
  opts?: { track?: boolean },
): () => void {
  const topic = `event:${eventId}:presence`;
  return sharedRoom<PresenceMember>(client, topic, (room) => {
    const channel = client.channel(topic);
    let joined = false;
    let tracked = false;

    // track() is derived from the member set rather than counted beside it: one live
    // track per room however many trackers it holds, dropped when the last one leaves.
    // Reconciled on join, on leave, and once at SUBSCRIBED — the first tracker normally
    // arrives before the join completes, so none of the three is redundant.
    const sync = () => {
      if (!joined) return;
      const wanted = [...room.members].some((m) => m.track);
      if (wanted === tracked) return;
      tracked = wanted;
      if (wanted) void channel.track({});
      else void channel.untrack();
    };

    channel.on('presence', { event: 'sync' }, () => {
      const count = Object.keys(channel.presenceState()).length;
      room.members.forEach((m) => m.onCount(count));
    });
    channel.subscribe((status) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        joined = true;
        sync();
      }
    });

    return { channel, sync };
  })({ onCount, track: opts?.track ?? false });
}

/**
 * A refusal from create-ticket-checkout. `code` is the server's `{error}` string — those
 * strings are the stable contract (#103); the screen maps them to copy. Plumbing only:
 * no message mapping here (rule api.md).
 */
export class TicketCheckoutError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`create-ticket-checkout refused: ${code} (${status})`);
    this.name = 'TicketCheckoutError';
  }
}

/**
 * Start a Stripe Checkout for a paid event via the create-ticket-checkout edge fn.
 * Returns the hosted Checkout URL (opened in expo-web-browser). Money flows server-side only
 * (rule #6) — the ticket is issued by the webhook (W1) and arrives via subscribeTicket.
 */
export async function createTicketCheckout(
  client: AthanorClient,
  eventId: string,
): Promise<{ url: string }> {
  const res = await client.functions.invoke<unknown>('create-ticket-checkout', {
    body: { eventId },
  });
  if (res.error) {
    // On a non-2xx, FunctionsHttpError hangs the Response off `.context` — the JSON body is
    // the only place the server's reason survives. Read it before rethrowing; an unreadable
    // body (relay/network failure, non-JSON) falls back to the raw error unchanged.
    const ctx = (res.error as { context?: { status?: number; json?: () => Promise<unknown> } })
      .context;
    if (ctx && typeof ctx.json === 'function' && typeof ctx.status === 'number') {
      let code: unknown;
      try {
        code = ((await ctx.json()) as { error?: unknown } | null)?.error;
      } catch {
        // body unreadable — rethrow the raw error below
      }
      if (typeof code === 'string') throw new TicketCheckoutError(code, ctx.status);
    }
    // supabase-js types FunctionsResponse.error as `any`; every concrete case
    // (FunctionsHttpError/RelayError/FetchError) extends FunctionsError extends Error.
    throw res.error as Error;
  }
  const url = (res.data as { url?: string } | null)?.url;
  if (!url) throw new Error('checkout did not return a url');
  return { url };
}

/**
 * Seats currently held on the paid path — paid + checked_in + unexpired pending claims
 * (#105). A definer count RPC because ticket rows are owner-only under RLS; feeds the
 * sold-out state on the event screen next to `event.capacity`.
 */
export async function getEventSeatsTaken(client: AthanorClient, eventId: string): Promise<number> {
  const { data, error } = await client.rpc('event_seats_taken', { p_event_id: eventId });
  if (error) throw error;
  return data ?? 0;
}

/** The viewer's own ticket for an event (null if they never bought one). Owner-reads-own RLS. */
export async function getMyTicket(
  client: AthanorClient,
  eventId: string,
  userId: string,
): Promise<Ticket | null> {
  const { data, error } = await client
    .from('event_tickets')
    .select(
      'id,user_id,event_id,stripe_payment_id,qr_token,status,expires_at,created_at,updated_at',
    )
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ? ticketSchema.parse(data) : null;
}

/**
 * Subscribe to the viewer's own ticket row for an event (realtime INSERT/UPDATE) — the buyer's app
 * flips `confirming → ticket-ready` when the webhook (W1) writes status='paid' (frontend §3.4 / §7 S3).
 * RLS only exposes the caller's own row; we also guard on user_id in the callback. Returns a cleanup fn
 * — callers MUST call it on unmount (rule api.md, invariant #1).
 */
export function subscribeTicket(
  client: AthanorClient,
  eventId: string,
  userId: string,
  onTicket: (ticket: Ticket) => void,
): () => void {
  const channel = client
    .channel(channelTopic(`ticket:${eventId}:${userId}`))
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'event_tickets',
        filter: `event_id=eq.${eventId}`,
      },
      (payload) => {
        const parsed = ticketSchema.safeParse(payload.new);
        if (parsed.success && parsed.data.user_id === userId) onTicket(parsed.data);
      },
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

/**
 * Submit a scanned QR to the `check-in` edge fn (organizer-only; verify_jwt=true). The fn verifies
 * the HMAC token, matches the event, asserts the caller is the organizer, records attendance
 * (idempotent) and flips the ticket paid→checked_in as service role (rule #6). Returns the verdict —
 * the app renders it; it NEVER writes attendance/money/Aura itself.
 */
export async function checkInScan(
  client: AthanorClient,
  eventId: string,
  qrToken: string,
): Promise<CheckInResult> {
  const res = await client.functions.invoke<unknown>('check-in', {
    body: { eventId, qrToken },
  });
  // supabase-js types FunctionsResponse.error as `any`; every concrete case
  // (FunctionsHttpError/RelayError/FetchError) extends FunctionsError extends Error.
  if (res.error) throw res.error as Error;
  return checkInResultSchema.parse(res.data);
}

/** Live arrived-count for an event. Organizer reads via RLS (holder-or-organizer). Head count only. */
export async function getEventCheckinCount(
  client: AthanorClient,
  eventId: string,
): Promise<number> {
  const { count, error } = await client
    .from('event_attendance')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Subscribe to new check-ins for an event (realtime INSERT on event_attendance). The organizer's
 * scanner increments its «{n} arrivati» counter live. Returns a cleanup fn — callers MUST call it on
 * unmount (.claude/rules/api.md invariant #1).
 */
export function subscribeAttendance(
  client: AthanorClient,
  eventId: string,
  onCheckIn: (row: Attendance) => void,
): () => void {
  const channel = client
    .channel(channelTopic(`event:${eventId}:attendance`))
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'event_attendance',
        filter: `event_id=eq.${eventId}`,
      },
      (payload) => {
        const parsed = attendanceSchema.safeParse(payload.new);
        if (parsed.success) onCheckIn(parsed.data);
      },
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

export type {
  Attendance,
  CheckInResult,
  Event,
  EventCategory,
  EventLiveStats,
  EventNearby,
  Ticket,
};
