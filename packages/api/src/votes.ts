import {
  type CandidacyTallyRow,
  candidacyTallyRowSchema,
  type CandidacyVote,
  candidacyVoteSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

export const voteKeys = {
  all: ['votes'] as const,
  mine: (editionId: string) => [...voteKeys.all, 'mine', editionId] as const,
  tally: (editionId: string) => [...voteKeys.all, 'tally', editionId] as const,
};

/** The caller's current vote in an edition, if any. Drives «Votato ✦» / move logic. */
export async function getMyVote(
  client: AthanorClient,
  editionId: string,
  voterId: string,
): Promise<CandidacyVote | null> {
  const { data, error } = await client
    .from('candidacy_votes')
    .select('*')
    .eq('edition_id', editionId)
    .eq('voter_id', voterId)
    .maybeSingle();
  if (error) throw error;
  return data ? candidacyVoteSchema.parse(data) : null;
}

/** Aura-weighted aggregate per candidacy (server fn — aggregates only, no voter_id). */
export async function getEditionTally(
  client: AthanorClient,
  editionId: string,
): Promise<CandidacyTallyRow[]> {
  const { data, error } = await client.rpc('candidacy_tally', { p_edition_id: editionId });
  if (error) throw error;
  return (data ?? []).map((row) => candidacyTallyRowSchema.parse(row));
}

/**
 * Cast (or move) the caller's vote — one atomic transaction server-side
 * (delete any existing vote in the edition + insert the new one). Awards 0 Aura.
 */
export async function castVote(
  client: AthanorClient,
  params: { editionId: string; candidacyId: string },
): Promise<void> {
  const { error } = await client.rpc('cast_vote', {
    p_edition_id: params.editionId,
    p_candidacy_id: params.candidacyId,
  });
  if (error) throw error;
}

export type { CandidacyTallyRow, CandidacyVote };
