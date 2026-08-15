import { isSkill } from '@athanor/core';
import {
  type CandidacyInsert,
  type CandidacyUpdate,
  type CandidateCard,
  candidateCardSchema,
  type DreamCandidacy,
  dreamCandidacySchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';
import { keysetFilter, nextCursorOf } from './pagination';

export const candidacyKeys = {
  all: ['candidacy'] as const,
  mine: (editionId: string) => [...candidacyKeys.all, 'mine', editionId] as const,
  priorMine: (editionId: string) => [...candidacyKeys.all, 'priorMine', editionId] as const,
  detail: (id: string) => [...candidacyKeys.all, 'detail', id] as const,
  list: (editionId: string, cursor?: string | null) =>
    [...candidacyKeys.all, 'list', editionId, cursor ?? null] as const,
};

/** Opaque keyset cursor — the last (created_at, candidacy_id) seen. Never an offset (rule #9). */
export type CandidateCursor = { created_at: string; candidacy_id: string };

const CANDIDATE_PAGE_SIZE = 20;

/** Storage key convention for a candidacy video: `{uid}/{candidacy_id}.mp4` (10 §4.1). */
export function candidacyVideoPath(uid: string, candidacyId: string): string {
  return `${uid}/${candidacyId}.mp4`;
}

/**
 * Storage key for a candidacy's poster frame: `${uid}/${candidacyId}-thumb.jpg`.
 *
 * Same folder as `candidacyVideoPath`, deliberately: every `candidacy_videos_*` policy gates on
 * the first path segment matching the caller's uid, so a poster written here is covered by the
 * video's policies and needs none of its own.
 */
export function candidacyThumbPath(uid: string, candidacyId: string): string {
  return `${uid}/${candidacyId}-thumb.jpg`;
}

/**
 * The caller's own candidacy for an edition — one row at most
 * (`dream_candidacies_one_per_edition`). Null when none. Feeds the explicit
 * edit/resubmit flow (#226): the wizard prefills from this row only when the
 * member chooses to edit, never automatically.
 */
export async function getMyCandidacy(
  client: AthanorClient,
  editionId: string,
  profileId: string,
): Promise<DreamCandidacy | null> {
  const { data, error } = await client
    .from('dream_candidacies')
    .select('*')
    .eq('edition_id', editionId)
    .eq('profile_id', profileId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return data ? dreamCandidacySchema.parse(data) : null;
}

/**
 * The caller's most recent candidacy from any OTHER cycle (#221 — FUND-35's cross-cycle
 * half). Cycles are sequential and only one is ever non-closed, so "not the current
 * edition" means "a closed prior cycle". Feeds the explicit re-submission prefill: the
 * wizard reads this row's text fields into a FRESH submit (a prior-cycle row is terminal
 * — 'voided'/'rejected'/'winner' — so updateCandidacy can never reach it); nothing
 * auto-carries (pgTAP 0110 asserts the old row stays untouched). Own-row RLS covers
 * closed editions (dream_candidacies_select_visible, own arm).
 */
export async function getMyLatestPriorCandidacy(
  client: AthanorClient,
  currentEditionId: string,
  profileId: string,
): Promise<DreamCandidacy | null> {
  const { data, error } = await client
    .from('dream_candidacies')
    .select('*')
    .neq('edition_id', currentEditionId)
    .eq('profile_id', profileId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? dreamCandidacySchema.parse(data) : null;
}

/**
 * Submit a candidacy. `id` is generated client-side so the video can be uploaded
 * to `{uid}/{id}.mp4` BEFORE the row exists; profile_id + status are server-pinned
 * by RLS WITH CHECK (status must be 'submitted'; insert requires identity_verified;
 * dream_id, when set, must be the author's own dream).
 *
 * skills_needed is bounded against @athanor/core SKILLS here (#225, FUND-10): the DB
 * bounds shape and cardinality only (the profiles.skills pattern), so the vocabulary
 * membership check lives at this boundary — a free-text key would silently break the
 * member-surfacing intersection the field exists for.
 */
export async function submitCandidacy(
  client: AthanorClient,
  params: { id: string; profileId: string; input: CandidacyInsert },
): Promise<DreamCandidacy> {
  const { id, profileId, input } = params;
  const unknownSkill = input.skills_needed.find((s) => !isSkill(s));
  if (unknownSkill !== undefined) {
    throw new Error(
      `skills_needed carries a key outside the curated SKILLS vocabulary: ${unknownSkill}`,
    );
  }
  const { data, error } = await client
    .from('dream_candidacies')
    .insert({ ...input, id, profile_id: profileId, status: 'submitted' })
    .select('*')
    .single();
  if (error) throw error;
  return dreamCandidacySchema.parse(data);
}

/**
 * Edit an own candidacy while it is still 'submitted' (#226 — same-cycle, pre-screening).
 * RLS (dream_candidacies_update_own_submitted) pins row ownership, keeps status
 * 'submitted' (USING + WITH CHECK) and re-checks dream ownership on dream_id; the patch
 * never carries edition_id/profile_id/status (candidacyUpdateSchema strips them).
 * skills_needed is bounded against @athanor/core SKILLS here, exactly as in
 * submitCandidacy — the DB bounds shape and cardinality only.
 */
export async function updateCandidacy(
  client: AthanorClient,
  id: string,
  patch: CandidacyUpdate,
): Promise<DreamCandidacy> {
  const unknownSkill = (patch.skills_needed ?? []).find((s) => !isSkill(s));
  if (unknownSkill !== undefined) {
    throw new Error(
      `skills_needed carries a key outside the curated SKILLS vocabulary: ${unknownSkill}`,
    );
  }
  const { data, error } = await client
    .from('dream_candidacies')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return dreamCandidacySchema.parse(data);
}

/** One page of an edition's candidate cards, newest-first by (created_at, candidacy_id). */
export async function getCandidates(
  client: AthanorClient,
  opts: { editionId: string; cursor?: CandidateCursor | null; limit?: number },
): Promise<{ items: CandidateCard[]; nextCursor: CandidateCursor | null }> {
  const limit = opts.limit ?? CANDIDATE_PAGE_SIZE;
  let query = client
    .from('fund_candidate_cards')
    .select('*')
    .eq('edition_id', opts.editionId)
    .order('created_at', { ascending: false })
    .order('candidacy_id', { ascending: false })
    .limit(limit);
  if (opts.cursor) {
    const { created_at, candidacy_id } = opts.cursor;
    query = query.or(keysetFilter('created_at', 'candidacy_id', created_at, candidacy_id, 'lt'));
  }
  const { data, error } = await query;
  if (error) throw error;
  const items = (data ?? []).map((row) => candidateCardSchema.parse(row));
  const nextCursor = nextCursorOf(items, limit, (last) => ({
    created_at: last.created_at,
    candidacy_id: last.candidacy_id,
  }));
  return { items, nextCursor };
}

/**
 * One candidate card by id — reads the `fund_candidate_cards` view filtered by
 * `candidacy_id` so the detail screen works from a deep link (no list row needed).
 * Returns null when absent (e.g. screened out / not visible to the caller).
 */
export async function getCandidateById(
  client: AthanorClient,
  candidacyId: string,
): Promise<CandidateCard | null> {
  const { data, error } = await client
    .from('fund_candidate_cards')
    .select('*')
    .eq('candidacy_id', candidacyId)
    .maybeSingle();
  if (error) throw error;
  return data ? candidateCardSchema.parse(data) : null;
}

export type { CandidateCard, DreamCandidacy };
