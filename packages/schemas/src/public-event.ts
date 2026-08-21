import { z } from 'zod';
import { eventCategorySchema } from './event';
import { handleSchema } from './profile';

/**
 * The public event read-model (issue #159) — what a logged-out visitor and a crawler
 * may see at /event/{id}. Deliberately NOT a `.pick()` of eventSchema: that shape is the
 * member-facing row, and the difference between the two is a trust boundary, not a
 * subset relationship. Omitted: `stream_url` (would hand a paid online event away for
 * free), `fee_pct` (server config), `capacity` (only meaningful next to an attendee count
 * anon cannot read) — all three also revoked from anon at the GRANT in migration
 * 20260812054134, since RLS filters rows and never columns. And `geo`: still granted to
 * anon (the anon-callable `events_nearby()` computes distance from it), so leaving it out
 * here is this model's own promise about the approximate location (PRD §4.2).
 *
 * `.strict()` so widening the read-model's select fails loudly here rather than
 * silently stripping the extra column and looking fine.
 *
 * `organizer_handle` is null when the organizer's profile is not public — RLS returns no
 * row and the read-model leaves it null; there is no branch to keep in step.
 */
export const publicEventSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).max(140),
    category: eventCategorySchema,
    is_online: z.boolean(),
    venue: z.string().max(240).nullable(),
    city: z.string().max(120).nullable(),
    starts_at: z.string(),
    ends_at: z.string().nullable(),
    price_cents: z.number().int().min(0),
    currency: z.string().regex(/^[a-z]{3}$/),
    is_kairos_day: z.boolean(),
    is_athanor_day: z.boolean(),
    organizer_handle: handleSchema.nullable(),
  })
  .strict();
export type PublicEvent = z.infer<typeof publicEventSchema>;

/**
 * One entry of the upcoming-events index — what `/event/[id]` prerenders and what the
 * sitemap lists (#335). Picked from the public read-model, and therefore still `.strict()`:
 * a widened select fails here rather than silently carrying a column the index never asked
 * for.
 */
export const upcomingEventEntrySchema = publicEventSchema
  .pick({ id: true })
  .extend({ updated_at: z.string() });
export type UpcomingEventEntry = z.infer<typeof upcomingEventEntrySchema>;
