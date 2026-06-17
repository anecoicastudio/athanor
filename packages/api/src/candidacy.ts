import {
  type CandidacyInsert,
  type CandidacyUpdate,
  type DreamCandidacy,
  dreamCandidacySchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

export const candidacyKeys = {
  all: ['candidacy'] as const,
  mine: (editionId: string) => [...candidacyKeys.all, 'mine', editionId] as const,
  detail: (id: string) => [...candidacyKeys.all, 'detail', id] as const,
  list: (editionId: string) => [...candidacyKeys.all, 'list', editionId] as const,
};

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

export type { DreamCandidacy };
