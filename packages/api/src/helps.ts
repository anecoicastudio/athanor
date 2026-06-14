import {
  type Help,
  type HelpInsert,
  helpInsertSchema,
  helpRespondSchema,
  helpSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

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
 * Owner confirms a help is done: help status accepted->completed, then the tappa -> done.
 * Both are owner-allowed writes; this is the +40 (helper) / +10 (owner) domain event the
 * M6 engine reads. Writes NO aura_* (rule #1).
 * TODO(M6): score-engine (backend `07`) consumes status='completed' + milestone='done'
 * and awards +40 helper / +10 owner + star progress (service-role only).
 */
export async function confirmHelpComplete(
  client: AthanorClient,
  helpId: string,
  milestoneId: string,
): Promise<void> {
  const { error: helpErr } = await client
    .from('milestone_helps')
    .update({ status: 'completed' })
    .eq('id', helpId)
    .is('deleted_at', null);
  if (helpErr) throw helpErr;
  const { error: msErr } = await client
    .from('dream_milestones')
    .update({ status: 'done' })
    .eq('id', milestoneId)
    .is('deleted_at', null);
  if (msErr) throw msErr;
}

/** Incoming offers on my dream (owner-confirm surface). Newest first by the keyset index. */
export async function listIncomingHelps(
  client: AthanorClient,
  milestoneIds: string[],
): Promise<Help[]> {
  if (milestoneIds.length === 0) return [];
  const { data, error } = await client
    .from('milestone_helps')
    .select('*')
    .in('milestone_id', milestoneIds)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => helpSchema.parse(row));
}

/** Offers I made (drives the per-tappa help-state on others' dreams). */
export async function listMyHelps(client: AthanorClient, helperId: string): Promise<Help[]> {
  const { data, error } = await client
    .from('milestone_helps')
    .select('*')
    .eq('helper_id', helperId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => helpSchema.parse(row));
}
