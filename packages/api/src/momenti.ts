import {
  type AcceptMomentResult,
  type MomentoDeckCard,
  type MomentoSuggestion,
  acceptMomentResult,
  momentoDeckCard,
  momentoSuggestion,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

export const momentiKeys = {
  all: ['momenti'] as const,
  deck: () => [...momentiKeys.all, 'deck'] as const,
  suggestions: () => [...momentiKeys.all, 'suggestions'] as const,
};

/** Shape of one `momento_proposals` row joined to the peer profile + active dream quote. */
type DeckRow = {
  id: string;
  candidate_id: string;
  reasons: string[];
  status: 'pending' | 'accepted' | 'passed';
  candidate: { handle: string | null; dreams: { text: string }[] } | null;
};

/** Map a joined proposal row to the deck-card read model. `affinity` is never selected/exposed. */
export function rowToDeckCard(row: DeckRow): MomentoDeckCard {
  return momentoDeckCard.parse({
    id: row.id,
    candidateId: row.candidate_id,
    handle: row.candidate?.handle ?? null,
    reasons: row.reasons ?? [],
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
  return (data ?? [])
    .map((r) => rowToDeckCard(r as unknown as DeckRow))
    .filter((card) => card.dreamText != null);
}

/**
 * «Ti potrebbe interessare» — one curated-lite peer (newest other member with an active dream,
 * not in today's deck). Real affinity-ranked curation is deferred (no suggestions table in M5).
 */
export async function getMomentiSuggestion(
  client: AthanorClient,
  excludeIds: string[],
): Promise<MomentoSuggestion | null> {
  const { data: me } = await client.auth.getUser();
  const exclude = [me.user?.id, ...excludeIds].filter(Boolean) as string[];
  let query = client
    .from('profiles')
    .select('id, handle, dreams!inner(text, status, deleted_at)')
    .eq('dreams.status', 'active')
    .is('dreams.deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (exclude.length) query = query.not('id', 'in', `(${exclude.join(',')})`);
  const { data, error } = await query;
  if (error) throw error;
  const row = data?.[0] as
    | { id: string; handle: string | null; dreams: { text: string }[] }
    | undefined;
  if (!row) return null;
  return momentoSuggestion.parse({
    candidateId: row.id,
    handle: row.handle,
    dreamText: row.dreams?.[0]?.text ?? null,
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
