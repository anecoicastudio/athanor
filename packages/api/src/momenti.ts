import {
  type AcceptMomentResult,
  type MomentoDeckCard,
  type MomentoDeckRow,
  type MomentoSuggestion,
  acceptMomentResult,
  momentoDeckCard,
  momentoDeckRow,
  momentoSuggestion,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

export const momentiKeys = {
  all: ['momenti'] as const,
  deck: () => [...momentiKeys.all, 'deck'] as const,
  suggestions: () => [...momentiKeys.all, 'suggestions'] as const,
};

/** Parse a joined proposal row, then map it to the deck card. `affinity` is never selected/exposed. */
export function rowToDeckCard(raw: unknown): MomentoDeckCard {
  const row: MomentoDeckRow = momentoDeckRow.parse(raw);
  return momentoDeckCard.parse({
    id: row.id,
    candidateId: row.candidate_id,
    handle: row.candidate?.handle ?? null,
    reasons: row.reasons,
    dreamText: row.candidate?.dreams?.[0]?.text ?? null,
    status: row.status,
  });
}

/**
 * Today's ≤3 pending proposals (already server-capped). `affinity` is NEVER selected (rule #1 —
 * the score is not client-readable here); the explicit column list excludes it. Bounded `.limit(3)`,
 * no offset (rule #9).
 *
 * Dream-less cards are dropped: the matcher skips candidates whose dream is private, but a
 * candidate can flip `visibility.dream` (or archive the dream) AFTER the proposal row exists,
 * and the embed is then RLS-filtered to null. A Momento without a dream has nothing to answer.
 */
export async function getMomentiDeck(client: AthanorClient): Promise<MomentoDeckCard[]> {
  const { data, error } = await client
    .from('momento_proposals')
    .select(
      'id, candidate_id, reasons, status, candidate:profiles!momento_proposals_candidate_id_fkey(handle, dreams(text))',
    )
    .eq('status', 'pending')
    .order('daily_rank', { ascending: true })
    .limit(3);
  if (error) throw error;
  return (data ?? []).map((r) => rowToDeckCard(r)).filter((card) => card.dreamText != null);
}

/**
 * «Ti potrebbe interessare» — one curated-lite peer: the most recently written visible active
 * dream, not in today's deck. Real affinity-ranked curation is deferred (no suggestions table in
 * M5) — this ranks by dream recency, which is why the UI chip says «Sogno nuovo», not «Alta
 * affinità». It is NOT ordered by member recency: profiles.updated_at is a touch timestamp.
 *
 * Goes through the get_momenti_suggestion RPC rather than a client query: the filter has to read
 * `profiles.visibility` to drop members who hid BOTH tag fields, and M10 column-scoped the
 * authenticated SELECT grant so that column never reaches the client. Blocks, dream visibility
 * and the caller's own id are re-established inside the function — see the migration.
 */
export async function getMomentiSuggestion(
  client: AthanorClient,
  excludeIds: string[],
): Promise<MomentoSuggestion | null> {
  // No caller id here: the RPC derives it from auth.uid() (rule #8). p_exclude carries only
  // today's deck.
  const { data, error } = await client.rpc('get_momenti_suggestion', { p_exclude: excludeIds });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return momentoSuggestion.parse({
    candidateId: row.candidate_id,
    handle: row.handle,
    dreamText: row.dream_text,
  });
}

/**
 * «Connetti ✦» — flips own proposal to accepted server-side and reports a mutual match.
 * The RPC returns snake_case `conversation_id`; map it to the camelCase schema field.
 */
export async function acceptMoment(
  client: AthanorClient,
  proposalId: string,
): Promise<AcceptMomentResult> {
  const { data, error } = await client.rpc('accept_momento', { p_proposal_id: proposalId });
  if (error) throw error;
  const raw = data as { matched: boolean; conversation_id: string | null };
  return acceptMomentResult.parse({
    matched: raw.matched,
    conversationId: raw.conversation_id ?? null,
  });
}

/**
 * «Passa» — status flip; the guard trigger sets `passed_until` (+90d). The column-level grant
 * blocks any other column, so this only ever writes `status`.
 */
export async function passMoment(client: AthanorClient, proposalId: string): Promise<void> {
  const { error } = await client
    .from('momento_proposals')
    .update({ status: 'passed' })
    .eq('id', proposalId);
  if (error) throw error;
}
