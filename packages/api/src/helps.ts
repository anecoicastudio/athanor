import {
  type Help,
  type HelpInsert,
  helpInsertSchema,
  helpRespondSchema,
  helpSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';
import { keysetFilter, nextCursorOf } from './pagination';

export const helpKeys = {
  all: ['milestoneHelps'] as const,
  incoming: (profileId: string) => ['milestoneHelps', 'incoming', profileId] as const, // owner-side
  mine: (helperId: string) => ['milestoneHelps', 'mine', helperId] as const, // helper-side
};

/**
 * Helper offers help on a tappa (skill/connection/opportunity — NO money, Fase 1).
 * helper_id is set from the caller's auth uid; RLS forces status='offered' and blocks
 * offering on your own tappa. Unique (milestone_id, helper_id) → re-offer raises 23505.
 */
export async function offerHelp(
  client: AthanorClient,
  helperId: string,
  insert: HelpInsert,
): Promise<void> {
  const payload = helpInsertSchema.parse(insert);
  const { error } = await client.from('milestone_helps').insert({
    milestone_id: payload.milestone_id,
    helper_id: helperId,
    type: payload.type,
    message: payload.message ?? null,
    link: payload.link ?? null,
  });
  if (error) throw error;
}

/** Owner accepts or declines an offer (status-only; the DB guard enforces legal edges). */
export async function respondToHelp(
  client: AthanorClient,
  helpId: string,
  status: 'accepted' | 'declined',
): Promise<void> {
  const { status: next } = helpRespondSchema.parse({ status });
  const { error } = await client
    .from('milestone_helps')
    .update({ status: next })
    .eq('id', helpId)
    .is('deleted_at', null);
  if (error) throw error;
}

/**
 * Owner confirms a help is done. Delegates to the `confirm_milestone_help` RPC, which sets
 * the help status accepted->completed AND the parent tappa -> done in ONE transaction (atomic —
 * the two states can never diverge). The RPC is SECURITY INVOKER, so the owner-only RLS + the
 * legal-edge guard still apply, and it derives the tappa from the help so no mismatched
 * milestone id is possible. This is the +40 (helper) / +10 (owner) domain event the M6 engine
 * reads. Writes NO aura_* (rule #1).
 * TODO(M6): score-engine (backend `07`) consumes status='completed' + milestone='done'
 * and awards +40 helper / +10 owner + star progress (service-role only).
 */
export async function confirmHelpComplete(client: AthanorClient, helpId: string): Promise<void> {
  const { error } = await client.rpc('confirm_milestone_help', { p_help_id: helpId });
  if (error) throw error;
}

/** Opaque keyset cursor over milestone_helps — the last (created_at, id) seen. Never an offset. */
export type HelpCursor = { created_at: string; id: string };
export type HelpsPage = { rows: Help[]; nextCursor: HelpCursor | null };

/**
 * Page size for both help readers. Larger than the 20 the ledger/needs lists use because
 * both callers render the whole first page as a single list rather than an infinite feed —
 * but bounded all the same (rule #9), so a member with hundreds of offers can no longer
 * pull the entire table down in one request.
 */
const HELPS_PAGE_SIZE = 50;

/** Parse a fetched page and derive its keyset cursor — the half both readers share. */
function helpsPage(data: unknown[] | null, limit: number): HelpsPage {
  const rows = (data ?? []).map((row) => helpSchema.parse(row));
  return {
    rows,
    nextCursor: nextCursorOf(rows, limit, (last) => ({
      created_at: last.created_at,
      id: last.id,
    })),
  };
}

/**
 * Incoming offers on my dream (owner-confirm surface). Newest first by the keyset index,
 * one bounded page at a time (rule #9: cursor pagination, never offset).
 */
export async function listIncomingHelps(
  client: AthanorClient,
  milestoneIds: string[],
  cursor?: HelpCursor | null,
  limit = HELPS_PAGE_SIZE,
): Promise<HelpsPage> {
  if (milestoneIds.length === 0) return { rows: [], nextCursor: null };
  let q = client
    .from('milestone_helps')
    .select('*')
    .in('milestone_id', milestoneIds)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (cursor) q = q.or(keysetFilter('created_at', 'id', cursor.created_at, cursor.id, 'lt'));
  const { data, error } = await q;
  if (error) throw error;
  return helpsPage(data, limit);
}

/**
 * My offers on a specific set of tappe — the per-tappa help-state on someone's dream. Scoped
 * rather than paginated-and-hoped: a dream has a handful of tappe, so one page covers them all
 * regardless of how much the caller has helped elsewhere. An unscoped read here would show an
 * already-helped tappa as un-helped, and re-offering hits the (milestone_id, helper_id) unique
 * index -- a 23505 the help sheet reports as success, so the member sees nothing happen.
 */
export async function listMyHelpsForMilestones(
  client: AthanorClient,
  helperId: string,
  milestoneIds: string[],
  cursor?: HelpCursor | null,
  limit = HELPS_PAGE_SIZE,
): Promise<HelpsPage> {
  if (milestoneIds.length === 0) return { rows: [], nextCursor: null };
  let q = client
    .from('milestone_helps')
    .select('*')
    .eq('helper_id', helperId)
    .is('deleted_at', null)
    .in('milestone_id', milestoneIds);
  q = q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit);
  if (cursor) q = q.or(keysetFilter('created_at', 'id', cursor.created_at, cursor.id, 'lt'));
  const { data, error } = await q;
  if (error) throw error;
  return helpsPage(data, limit);
}
