import { z } from 'zod';

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
  stream_url: z.string().nullable(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  capacity: z.number().int().positive().nullable(),
  price_cents: z.number().int().min(0),
  currency: z.string().regex(/^[a-z]{3}$/),
  fee_pct: z.number().min(0).max(100),
  is_kairos_day: z.boolean(),
  is_athanor_day: z.boolean(),
  cover_url: z.string().nullable(),
  live_started_at: z.string().nullable(),
  live_ended_at: z.string().nullable(),
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
    title: z.string().trim().min(1, 'event title must not be blank').max(140),
    category: eventCategorySchema,
    is_online: z.boolean(),
    venue: z.string().max(240).nullable().default(null),
    city: z.string().max(120).nullable().default(null),
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
  })
  .superRefine((v, ctx) => {
    if (v.is_online && !v.stream_url)
      ctx.addIssue({ code: 'custom', path: ['stream_url'], message: 'stream_url_required' });
    if (!v.is_online && (v.lat == null || v.long == null))
      ctx.addIssue({ code: 'custom', path: ['lat'], message: 'location_required' });
  });
export type EventCreate = z.infer<typeof eventCreateSchema>;

/** Athanor Days "Avvisami" registration. */
export const athanorDaysInterestSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  edition: z.string().max(80).nullable(),
  created_at: z.string(),
});
export type AthanorDaysInterest = z.infer<typeof athanorDaysInterestSchema>;

/**
 * rsvp — free-event attendance intent (mirrors public.rsvps). Toggle is going⇄cancelled;
 * the (user_id, event_id) pair is the idempotency key. No deleted_at (intent, not content).
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
