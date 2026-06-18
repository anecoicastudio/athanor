import {
  type CandidacyInsert,
  type CandidacyUpdate,
  type CandidateCard,
  candidateCardSchema,
  type DreamCandidacy,
  dreamCandidacySchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

export const candidacyKeys = {
  all: ['candidacy'] as const,
  mine: (editionId: string) => [...candidacyKeys.all, 'mine', editionId] as const,
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

/** The caller's own candidacy for an edition, if any (the one-per-edition unique row). */
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
 * Submit a candidacy. `id` is generated client-side so the video can be uploaded
 * to `{uid}/{id}.mp4` BEFORE the row exists; profile_id + status are server-pinned
 * by RLS WITH CHECK (status must be 'submitted'; insert requires identity_verified).
 */
export async function submitCandidacy(
  client: AthanorClient,
  params: { id: string; profileId: string; input: CandidacyInsert },
): Promise<DreamCandidacy> {
  const { id, profileId, input } = params;
  const { data, error } = await client
    .from('dream_candidacies')
    .insert({ ...input, id, profile_id: profileId, status: 'submitted' })
    .select('*')
    .single();
  if (error) throw error;
  return dreamCandidacySchema.parse(data);
}

/** Edit an own candidacy while it is still 'submitted' (RLS pins the window). */
export async function updateCandidacy(
  client: AthanorClient,
  id: string,
  patch: CandidacyUpdate,
): Promise<DreamCandidacy> {
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
    query = query.or(
      `created_at.lt.${created_at},and(created_at.eq.${created_at},candidacy_id.lt.${candidacy_id})`,
    );
  }
  const { data, error } = await query;
  if (error) throw error;
  const items = (data ?? []).map((row) => candidateCardSchema.parse(row));
  const last = items.length === limit ? items.at(-1) : undefined;
  const nextCursor = last ? { created_at: last.created_at, candidacy_id: last.candidacy_id } : null;
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
