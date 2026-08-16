import {
  type RealizationPlanInsert,
  type RealizationPlanPhaseInsert,
  type RealizationPlanPhaseRow,
  type RealizationPlanPhaseUpdate,
  type RealizationPlanRow,
  type RealizationPlanUpdate,
  realizationPlanPhaseSchema,
  realizationPlanSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

export const realizationPlanKeys = {
  all: ['realizationPlan'] as const,
  byEdition: (editionId: string) => [...realizationPlanKeys.all, 'edition', editionId] as const,
  phases: (planId: string) => [...realizationPlanKeys.all, 'phases', planId] as const,
};

/**
 * The realization plan of one cycle, or null. `edition_id` is unique in-table, so this is a
 * single row by construction — one plan per cycle, one cycle per plan.
 *
 * Visibility is entirely RLS's: the world sees it once `published_at` is set, its author
 * sees their own draft, an admin sees both. A null here therefore means «no plan, or none
 * you may see» and the screen must not read it as «not written yet» for anyone but the
 * author (who is the only caller that can tell the difference).
 */
export async function getRealizationPlan(
  client: AthanorClient,
  editionId: string,
): Promise<RealizationPlanRow | null> {
  const { data, error } = await client
    .from('realization_plans')
    .select('*')
    .eq('edition_id', editionId)
    .maybeSingle();
  if (error) throw error;
  return data ? realizationPlanSchema.parse(data) : null;
}

/**
 * A plan's phases in plan order. Not paginated, and rule #9 is not bypassed here: a phase
 * list is a bounded per-plan set the payable ceiling caps in euros — it is one object read
 * as a whole, like the plan's prose, not a feed that grows.
 */
export async function getRealizationPlanPhases(
  client: AthanorClient,
  planId: string,
): Promise<RealizationPlanPhaseRow[]> {
  const { data, error } = await client
    .from('realization_plan_phases')
    .select('*')
    .eq('plan_id', planId)
    .order('sort', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => realizationPlanPhaseSchema.parse(row));
}

/**
 * Start the plan. The row lands as a draft because `published_at` is not a column any
 * client may write — publication is `publishRealizationPlan`, below.
 *
 * Everything that makes this legitimate is server-side: RLS pins the candidacy to the
 * caller, and #228's binds_winner trigger refuses a candidacy that did not win its cycle or
 * whose winner never confirmed viability (#220).
 */
export async function createRealizationPlan(
  client: AthanorClient,
  input: RealizationPlanInsert,
): Promise<RealizationPlanRow> {
  const { data, error } = await client.from('realization_plans').insert(input).select('*').single();
  if (error) throw error;
  return realizationPlanSchema.parse(data);
}

/** Edit a draft's prose. RLS refuses once the plan is published (USING + WITH CHECK). */
export async function updateRealizationPlan(
  client: AthanorClient,
  planId: string,
  patch: RealizationPlanUpdate,
): Promise<RealizationPlanRow> {
  const { data, error } = await client
    .from('realization_plans')
    .update(patch)
    .eq('id', planId)
    .select('*')
    .single();
  if (error) throw error;
  return realizationPlanSchema.parse(data);
}

/**
 * Add a phase to a draft. The payable ceiling is the database's: a phase that would take
 * the plan's sum past `floor(confirmed_pool × (100 − split) / 100)` raises
 * `phases exceed declared payable` and nothing lands. Nothing is clamped here — the member
 * is told what the money is, not quietly given less than they typed.
 */
export async function addRealizationPlanPhase(
  client: AthanorClient,
  input: RealizationPlanPhaseInsert,
): Promise<RealizationPlanPhaseRow> {
  const { data, error } = await client
    .from('realization_plan_phases')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return realizationPlanPhaseSchema.parse(data);
}

/**
 * Re-cost or re-word a draft phase IN PLACE.
 *
 * There is no delete-and-recreate path here on purpose: `fund_payout_ledger.plan_phase_id`
 * is ON DELETE SET NULL, so a recreated phase is a new id and the release that funded the
 * old one silently loses its attribution. Editing keeps the id, so it keeps the link.
 */
export async function updateRealizationPlanPhase(
  client: AthanorClient,
  phaseId: string,
  patch: RealizationPlanPhaseUpdate,
): Promise<RealizationPlanPhaseRow> {
  const { data, error } = await client
    .from('realization_plan_phases')
    .update(patch)
    .eq('id', phaseId)
    .select('*')
    .single();
  if (error) throw error;
  return realizationPlanPhaseSchema.parse(data);
}

/**
 * Remove a phase from a DRAFT. The draft-only boundary is the delete policy's, not this
 * function's — after publication the statement matches no row and the phase stays, which is
 * what keeps a funded release's attribution from being dropped.
 */
export async function deleteRealizationPlanPhase(
  client: AthanorClient,
  phaseId: string,
): Promise<void> {
  const { error } = await client.from('realization_plan_phases').delete().eq('id', phaseId);
  if (error) throw error;
}

/**
 * The refusals `publish_realization_plan()` and the plan triggers raise, verbatim. The
 * server's string IS the contract (#103 idiom, as in `ContributionSessionError`): the
 * screen maps each to copy, so a ceiling refusal never reads as a failed save.
 */
export const PLAN_REFUSALS = [
  'auth required',
  'plan not found',
  'not the plan author',
  'plan already published',
  'edition not found',
  'publication out of phase',
  'viability not confirmed',
  'plan has no phases',
  'phases exceed declared payable',
  'plan does not bind the cycle winner',
  'no winner declared',
] as const;
export type PlanRefusal = (typeof PLAN_REFUSALS)[number];

/**
 * The named refusal inside a Postgres error, or null when the failure is something else
 * (a network drop, an RLS denial, a constraint). Matched with `includes` because PostgREST
 * wraps the raised text; the strings are distinct enough that no two can both match.
 */
export function planRefusalOf(error: unknown): PlanRefusal | null {
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message !== 'string') return null;
  return PLAN_REFUSALS.find((refusal) => message.includes(refusal)) ?? null;
}

/**
 * Publish the plan: it becomes world-readable and the cycle enters realization, in one
 * transaction with its audit row. Returns the publication timestamp.
 *
 * Every refusal is the server's — authorship, phase, viability, «no phases», the ceiling.
 * None of them is pre-checked here: a client-side gate would be a second opinion about
 * money, and the one that matters is the database's.
 */
export async function publishRealizationPlan(
  client: AthanorClient,
  planId: string,
): Promise<string> {
  const { data, error } = await client.rpc('publish_realization_plan', { p_plan_id: planId });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('publish_realization_plan returned no timestamp');
  return data;
}

export type {
  RealizationPlanInsert,
  RealizationPlanPhaseInsert,
  RealizationPlanPhaseRow,
  RealizationPlanPhaseUpdate,
  RealizationPlanRow,
  RealizationPlanUpdate,
};
