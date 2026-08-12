import { z } from 'zod';
import { eventCategorySchema } from './event';
import { handleSchema } from './profile';

/**
 * The public event read-model (issue #159) — what a logged-out visitor and a crawler
 * may see at /event/{id}. Deliberately NOT a `.pick()` of eventSchema: that shape is the
 * member-facing row, and the difference between the two is the trust boundary, not a
 * subset relationship. Columns anon may read in Postgres but that must never reach a
 * public page: `geo` (approximate location is a privacy property, PRD §4.2), `stream_url`
 * (would hand a paid online event away for free), `fee_pct` (server config), `capacity`
 * (only meaningful next to an attendee count anon cannot read).
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
