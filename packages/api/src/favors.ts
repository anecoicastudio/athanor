import {
  type FavorInsert,
  type FavorNeed,
  favorInsertSchema,
  favorNeedSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';
import { keysetFilter, nextCursorOf } from './pagination';

export const favorKeys = {
  all: ['favorOffers'] as const,
  openNeeds: ['favorOffers', 'openNeeds'] as const, // the Passa il Favore list
  incoming: (targetId: string) => ['favorOffers', 'incoming', targetId] as const,
  mine: (actorId: string) => ['favorOffers', 'mine', actorId] as const,
};

/** Opaque keyset cursor over favor_needs — the last (need_created_at, need_milestone_id) seen. Never an offset. */
export type NeedCursor = { need_created_at: string; need_milestone_id: string };
export type NeedsPage = { needs: FavorNeed[]; nextCursor: NeedCursor | null };

const NEEDS_PAGE_SIZE = 20;

/**
 * One page of open needs (the Passa il Favore list), newest-first by the
 * (need_created_at, need_milestone_id) keyset (rule #9: never offset). The `favor_needs`
 * view already excludes the viewer's own needs and any need they've already favored.
 */
export async function listOpenNeeds(
  client: AthanorClient,
  cursor?: NeedCursor | null,
  limit = NEEDS_PAGE_SIZE,
): Promise<NeedsPage> {
  let query = client
    .from('favor_needs')
    .select('*')
    .order('need_created_at', { ascending: false })
    .order('need_milestone_id', { ascending: false })
    .limit(limit);

  if (cursor) {
    const { need_created_at, need_milestone_id } = cursor;
    query = query.or(
      keysetFilter(
        'need_created_at',
        'need_milestone_id',
        need_created_at,
        need_milestone_id,
        'lt',
      ),
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  const needs = (data ?? []).map((row) => favorNeedSchema.parse(row));
  const nextCursor = nextCursorOf(needs, limit, (last) => ({
    need_created_at: last.need_created_at,
    need_milestone_id: last.need_milestone_id,
  }));
  return { needs, nextCursor };
}

/**
 * Pass a favor: a directed pay-it-forward offer to `target_id`, asking nothing back.
 * actor_id is set from the caller's auth uid; RLS forces actor = auth.uid and blocks
 * favoring yourself. Unique (actor_id, target_id, need) → a repeat raises 23505.
 * Writes ONLY favor_offers — never Aura (rule #1).
 * TODO(M6): the score-engine (backend `07`) reads this row and awards the Collaboratore
 * star + points once the help is real/confirmed (service-role only).
 *
 * The self-target guard lives here, not in favorInsertSchema: that schema deliberately
 * omits actor_id (it comes from auth.uid via RLS), so it cannot express the migration's
 * `check (actor_id <> target_id)`. Without this, favoring yourself sent a doomed insert
 * and surfaced a raw Postgres constraint error to the caller.
 */
export async function passFavor(
  client: AthanorClient,
  actorId: string,
  insert: FavorInsert,
): Promise<void> {
  const payload = favorInsertSchema.parse(insert);
  if (payload.target_id === actorId) {
    throw new Error('passFavor: target_id cannot be the actor — a favor goes to someone else');
  }
  const { error } = await client.from('favor_offers').insert({
    actor_id: actorId,
    target_id: payload.target_id,
    need: payload.need,
    need_milestone_id: payload.need_milestone_id ?? null,
  });
  if (error) throw error;
}
