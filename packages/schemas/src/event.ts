import { z } from 'zod';
import { trimmedNonBlank } from './primitives.ts';

/** Mirrors supabase/migrations events (public.event_category). Update both together. */
export const eventCategorySchema = z.enum([
  'business',
  'networking',
  'spiritualita',
  'formazione',
  'musica',
  'arte',
  'benessere',
  'creativi',
  'evoluzione',
]);
export type EventCategory = z.infer<typeof eventCategorySchema>;

/**
 * Read model for an event row. `geo` is intentionally OMITTED — the geography(Point)
 * column is write-only (set server-side via create_event from lat/long) and never
 * selected by the client (list-only browse this slice; no map). `feePct`/`priceCents`/
 * `is_*_day` are read-only on the client (server-config / M8).
 */
export const eventSchema = z.object({
  id: z.string().uuid(),
  organizer_id: z.string().uuid(),
  title: z.string().min(1).max(140),
  category: eventCategorySchema,
  is_online: z.boolean(),
  venue: z.string().max(240).nullable(),
  city: z.string().max(120).nullable(),
  /** Organizer-written; null renders as NOTHING, never a fallback paragraph (#634). */
  description: z.string().max(2000).nullable(),
  stream_url: z.string().nullable(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  capacity: z.number().int().positive().nullable(),
  price_cents: z.number().int().min(0),
  currency: z.string().regex(/^[a-z]{3}$/),
  fee_pct: z.number().min(0).max(100),
  is_athanor_day: z.boolean(),
  cover_url: z.string().nullable(),
  live_started_at: z.string().nullable(),
  live_ended_at: z.string().nullable(),
  /** When the organiser acknowledged manual settlement for THIS event (#437). Null on free events. */
  settlement_ack_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type Event = z.infer<typeof eventSchema>;

/** Projection returned by the events_nearby() RPC (Vicino / Mappa list rows). */
export const eventNearbySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  category: eventCategorySchema,
  starts_at: z.string(),
  venue: z.string().nullable(),
  city: z.string().nullable(),
  dist_meters: z.number(),
});
export type EventNearby = z.infer<typeof eventNearbySchema>;

/**
 * Create input — feeds the create_event() RPC. Carries lat/long (the server builds the
 * geography point). Omits feePct (server-config), status/qrToken (none here), cover_url
 * (upload deferred). The refinement mirrors the events_online_or_physical CHECK so the
 * form blocks before the DB rejects.
 */
export const eventCreateSchema = z
  .object({
    title: trimmedNonBlank(140, 'event title must not be blank'),
    category: eventCategorySchema,
    is_online: z.boolean(),
    venue: z.string().max(240).nullable().default(null),
    city: z.string().max(120).nullable().default(null),
    /**
     * Optional, unlike title: a blank description must land as NULL, because the detail
     * screens render null as nothing and `''` as an empty paragraph (#634).
     */
    description: z
      .string()
      .trim()
      .max(2000)
      .nullable()
      .default(null)
      .transform((v) => (v === '' ? null : v)),
    lat: z.number().min(-90).max(90).nullable().default(null),
    long: z.number().min(-180).max(180).nullable().default(null),
    stream_url: z.string().url().nullable().default(null),
    starts_at: z.string(),
    ends_at: z.string().nullable().default(null),
    capacity: z.number().int().positive().nullable().default(null),
    price_cents: z.number().int().min(0).default(0),
    currency: z
      .string()
      .regex(/^[a-z]{3}$/)
      .default('eur'),
    /**
     * The organiser's acknowledgement that settlement is manual, within 14 days of the event
     * ending, and pays the price minus processing costs (#437/#104). Input-only, like lat/long:
     * what lands on the row is `settlement_ack_at`, stamped by create_event from `now()`. A
     * client-supplied timestamp would be evidence of nothing.
     */
    settlement_ack: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.is_online && !v.stream_url)
      ctx.addIssue({ code: 'custom', path: ['stream_url'], message: 'stream_url_required' });
    if (!v.is_online && (v.lat == null || v.long == null))
      ctx.addIssue({ code: 'custom', path: ['lat'], message: 'location_required' });
    // Mirrors create_event's own refusal so the form blocks before the DB rejects — the same
    // reason the online/physical rule is duplicated here. The server check is the load-bearing
    // one: this schema runs on the client, and rule 5's gate is not the only thing a client can
    // be edited past.
    if (v.price_cents > 0 && !v.settlement_ack)
      ctx.addIssue({
        code: 'custom',
        path: ['settlement_ack'],
        message: 'settlement_ack_required',
      });
  });
export type EventCreate = z.infer<typeof eventCreateSchema>;

/**
 * rsvp — attendance intent (mirrors public.rsvps). Toggle is going⇄cancelled; the
 * (user_id, event_id) pair is the idempotency key. No deleted_at (intent, not content).
 *
 * The member's own tap is no longer the only source: since #522 stripe-webhook writes one of
 * these when a paid ticket settles, and flips it to 'cancelled' when the charge is reversed, so
 * that reminders and «N partecipano» reach ticket holders too. The shape is unchanged — a
 * mirrored row is indistinguishable here, which is the point.
 */
export const rsvpStatusSchema = z.enum(['going', 'cancelled']);
export type RsvpStatus = z.infer<typeof rsvpStatusSchema>;

export const rsvpSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  event_id: z.string().uuid(),
  status: rsvpStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
export type Rsvp = z.infer<typeof rsvpSchema>;

/**
 * event_live_stats row — public read; cron-maintained (live_window_sweep), never client-written.
 * Listener count is Realtime presence (subscribeEventPresence), not a column (#120).
 */
export const eventLiveStatsSchema = z.object({
  event_id: z.string().uuid(),
  is_live: z.boolean(),
  updated_at: z.string(),
});
export type EventLiveStats = z.infer<typeof eventLiveStatsSchema>;

/** event_tickets.status — pending until the webhook pays it; checked_in after a door scan (Slice B). */
export const ticketStatusSchema = z.enum(['pending', 'paid', 'checked_in', 'refunded']);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

/**
 * event_tickets row (mirrors public.event_tickets). Service-role-written money cache; the client
 * reads only its own row. `qr_token`/`stripe_payment_id` are NULL until W1 pays it.
 */
export const ticketSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  event_id: z.string().uuid(),
  stripe_payment_id: z.string().nullable(),
  qr_token: z.string().nullable(),
  status: ticketStatusSchema,
  /** Seat-hold TTL while status=pending (#105); NULL on paid/checked_in/refunded rows. */
  expires_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Ticket = z.infer<typeof ticketSchema>;

/**
 * event_attendance row (mirrors public.event_attendance). Immutable check-in record; the client
 * never writes it (the check-in edge fn does, RLS organizer-gated). Used to parse realtime INSERT
 * payloads for the live «{n} arrivati» counter.
 */
export const attendanceSchema = z.object({
  id: z.string().uuid(),
  ticket_id: z.string().uuid(),
  event_id: z.string().uuid(),
  checked_in_at: z.string(),
  scanned_by: z.string().uuid(),
  created_at: z.string(),
});
export type Attendance = z.infer<typeof attendanceSchema>;

/** Verdict returned by the `check-in` edge fn (200 for every scan outcome). `name` = holder handle. */
export const checkInResultSchema = z.object({
  result: z.enum(['valid', 'already', 'invalid', 'wrongEvent']),
  name: z.string().optional(),
});
export type CheckInResult = z.infer<typeof checkInResultSchema>;

/**
 * Calendar discovery filters (#151, PRD §4.6 «Filter by category/city/date»).
 *
 * City is the events table's own `city` column — plain text, max 120, written by
 * `event-create`'s reverse geocode (`20260615094844_events.sql`). It is NOT #149's
 * `profiles.city` / `city_geohash` pair, which the CityPicker feeds for the Momenti
 * matcher; the two representations are unrelated and nothing joins them today.
 *
 * The date window is an explicit `[dateFrom, dateTo]` pair of ISO strings rather than a
 * preset name, so no layer below the sheet has to read the clock: the sheet resolves
 * «questa settimana» to a concrete range and the query stays a pure function of its
 * arguments. Both bounds are inclusive and independently optional.
 */
export const eventCalendarFiltersSchema = z.object({
  category: eventCategorySchema.optional(),
  city: z.string().max(120).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});
export type EventCalendarFilters = z.infer<typeof eventCalendarFiltersSchema>;

/** True when no filter is set — what the query key and the «filtri attivi» dot both read as unfiltered. */
export function isEmptyEventCalendarFilters(filters?: EventCalendarFilters): boolean {
  if (!filters) return true;
  return (
    filters.category === undefined &&
    filters.city === undefined &&
    filters.dateFrom === undefined &&
    filters.dateTo === undefined
  );
}
