import { type PublicEvent, publicEventSchema } from '@athanor/schemas';
import type { AthanorClient } from './client';

export const publicEventKeys = {
  all: ['publicEvent'] as const,
  detail: (id: string) => ['publicEvent', 'detail', id] as const,
};

/*
 * The route segment is user input. A non-uuid reaches Postgres as 22P02 and comes back
 * as a PostgREST error, so /event/<anything> would 500 where it should 404. Matched here
 * rather than in the page so both callers of this read-model are guarded once.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The public event read-model (issue #159): assembled from anon, RLS-gated reads for the
 * SSR /event/{id} page. Returns null when the segment is not a uuid, or when no row
 * resolves (soft-deleted, or never existed) — both are a 404, not an error.
 *
 * The column list is the trust boundary and is deliberately narrower than `eventSchema`:
 * no `geo` (approximate location is a privacy property, PRD §4.2), no `stream_url` (it
 * would hand a paid online event away for free), no `fee_pct`, no `capacity`. `organizer_id`
 * is read only to resolve the handle and never returned; `publicEventSchema` is `.strict()`,
 * so a widened select here fails loudly instead of leaking.
 *
 * Plumbing only — no business logic, no Aura.
 */
export async function getPublicEventById(
  client: AthanorClient,
  id: string,
): Promise<PublicEvent | null> {
  if (!UUID.test(id)) return null;

  const { data: event, error: eErr } = await client
    .from('events')
    .select(
      'id, title, category, is_online, venue, city, starts_at, ends_at, price_cents, currency, is_kairos_day, is_athanor_day, organizer_id',
    )
    .eq('id', id)
    // RLS already hides deleted rows from anon; repeated here so the query is correct
    // under any client, and so it uses the `deleted_at is null` partial indexes.
    .is('deleted_at', null)
    .maybeSingle();
  if (eErr) throw eErr;
  if (!event) return null;

  // Anon may read `handle` (column GRANT) and RLS returns the row only when some section
  // of that profile is public. No row ⇒ the organizer is not named on the page; that is a
  // normal outcome, not an error, so it must not be confused with the throw below.
  const { data: organizer, error: oErr } = await client
    .from('profiles')
    .select('handle')
    .eq('id', event.organizer_id)
    .maybeSingle();
  if (oErr) throw oErr;

  const { organizer_id: _organizerId, ...publicColumns } = event;
  return publicEventSchema.parse({
    ...publicColumns,
    organizer_handle: organizer?.handle ?? null,
  });
}
