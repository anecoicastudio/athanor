import {
  type Event,
  type EventCategory,
  type EventCreate,
  type EventNearby,
  eventCreateSchema,
  eventNearbySchema,
  eventSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

export const eventKeys = {
  all: ['events'] as const,
  nearby: (lat: number, lng: number, radiusKm: number) =>
    [...eventKeys.all, 'nearby', lat, lng, radiusKm] as const,
  calendar: () => [...eventKeys.all, 'calendar'] as const,
  online: () => [...eventKeys.all, 'online'] as const,
  today: () => [...eventKeys.all, 'today'] as const,
  detail: (id: string) => [...eventKeys.all, 'detail', id] as const,
  byOrganizer: (uid: string) => [...eventKeys.all, 'organizer', uid] as const,
};

/** Columns the client reads (everything except the geography `geo` column). */
const EVENT_COLS =
  'id,organizer_id,title,category,is_online,venue,city,stream_url,starts_at,ends_at,capacity,price_cents,currency,fee_pct,is_kairos_day,is_athanor_day,cover_url,live_started_at,live_ended_at,created_at,updated_at,deleted_at';

const PAGE_SIZE = 20;

/** Opaque keyset cursor for the calendar (the last (starts_at, id) seen). Never an offset (rule #9). */
export type CalendarCursor = { starts_at: string; id: string };
export type CalendarPage = { events: Event[]; nextCursor: CalendarCursor | null };

/** Upcoming events ascending by (starts_at, id) — keyset, never offset. */
export async function getEventsCalendar(
  client: AthanorClient,
  cursor?: CalendarCursor | null,
  limit = PAGE_SIZE,
): Promise<CalendarPage> {
  // Upcoming only: hide events that already started (the calendar/«Oggi»/map previews
  // are "in arrivo"). Top-level filters AND together, so this composes with the keyset.
  const cutoff = new Date().toISOString();
  let query = client
    .from('events')
    .select(EVENT_COLS)
    .is('deleted_at', null)
    .gte('starts_at', cutoff)
    .order('starts_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit);

  if (cursor) {
    const { starts_at, id } = cursor;
    query = query.or(`starts_at.gt.${starts_at},and(starts_at.eq.${starts_at},id.gt.${id})`);
  }

  const { data, error } = await query;
  if (error) throw error;
  const events = (data ?? []).map((row) => eventSchema.parse(row as unknown));
  const last = events.length === limit ? events.at(-1) : undefined;
  const nextCursor = last ? { starts_at: last.starts_at, id: last.id } : null;
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
  const last = events.length === limit ? events.at(-1) : undefined;
  const nextCursor = last ? { dist: last.dist_meters, id: last.id } : null;
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
  return eventSchema.parse(data as unknown);
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

  const { data: id, error } = await client.rpc('create_event', rpcArgs);
  if (error) throw error;
  const created = await getEvent(client, id as string);
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

export type { Event, EventCategory, EventNearby };
