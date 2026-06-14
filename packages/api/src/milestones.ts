import {
  type Milestone,
  type MilestoneInsert,
  type MilestoneStatus,
  milestoneInsertSchema,
  milestoneSchema,
  milestoneStatusUpdateSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

export const milestoneKeys = {
  all: ['milestones'] as const,
  list: (dreamId: string) => ['milestones', 'dream', dreamId] as const,
};

/** Tappe of a dream, oldest-first by the (position, created_at, id) keyset (rule #9: never offset). */
export async function listMilestones(client: AthanorClient, dreamId: string): Promise<Milestone[]> {
  const { data, error } = await client
    .from('dream_milestones')
    .select('*')
    .eq('dream_id', dreamId)
    .is('deleted_at', null)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => milestoneSchema.parse(row));
}

/** Owner adds a tappa (RLS enforces owns_dream; status/position default server-side). */
export async function addMilestone(client: AthanorClient, insert: MilestoneInsert): Promise<void> {
  const payload = milestoneInsertSchema.parse(insert);
  const { error } = await client.from('dream_milestones').insert(payload);
  if (error) throw error;
}

/**
 * Owner marks a tappa done / in_progress. status→done is the +10 own-milestone domain
 * event the M6 engine reads — this writes only dream_milestones, never Aura (rule #1).
 * TODO(M6): wire the score-engine (backend `07`) to consume this status='done'
 * transition and award the +10 + «Creatore» star progress (service-role only).
 */
export async function updateMilestoneStatus(
  client: AthanorClient,
  id: string,
  status: MilestoneStatus,
): Promise<void> {
  const { status: next } = milestoneStatusUpdateSchema.parse({ status });
  const { error } = await client
    .from('dream_milestones')
    .update({ status: next })
    .eq('id', id)
    .is('deleted_at', null);
  if (error) throw error;
}

/** Soft-delete a tappa (owner UPDATE policy covers it; no hard delete). */
export async function softDeleteMilestone(client: AthanorClient, id: string): Promise<void> {
  const { error } = await client
    .from('dream_milestones')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null); // idempotent: double-delete is a no-op, not a re-stamp
  if (error) throw error;
}
