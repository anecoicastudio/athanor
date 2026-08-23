import { MOMENTO_DECK_REASON_LIMIT, rankReasons } from '@athanor/core';
import {
  type AcceptMomentResult,
  type MomentoDeckCard,
  type MomentoDeckRow,
  type MomentoReason,
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

/** Parse an RPC row, then map it to the deck card. `affinity` is never returned/exposed. */
export function rowToDeckCard(raw: unknown): MomentoDeckCard {
  const row: MomentoDeckRow = momentoDeckRow.parse(raw);
  // A term the candidate has masked comes back as [] and simply does not render — no empty
  // «Condividete:» line, and no stale one either (the server recomputes them per read).
  //
  // The order below is the WIRE order, not the display order: `rankReasons` decides which
  // of the seven a card with room for three actually shows (#384). Before it, this array's
  // order silently WAS the policy, and the two hardest-earned terms sat last.
  const terms: MomentoReason[] =
    row.reason_kind === 'new_dream'
      ? [{ kind: 'newDream', tags: [] }]
      : (
          [
            { kind: 'shared', tags: row.shared },
            { kind: 'seeking', tags: row.seek_hit },
            { kind: 'offering', tags: row.offer_hit },
            { kind: 'skills', tags: row.skills_shared },
            // `city` tags hold the candidate's city display name (never a geohash, #123).
            { kind: 'city', tags: row.city_near },
            // `mutualActivity` tags hold titles of events both sides checked in at (#361).
            { kind: 'mutualActivity', tags: row.mutual_activity },
            // `profession` tags hold the two profession keys of a complementary pair,
            // the caller's craft first (#361).
            { kind: 'profession', tags: row.profession_pair },
          ] as const
        ).filter((term) => term.tags.length > 0);
  return momentoDeckCard.parse({
    id: row.proposal_id,
    candidateId: row.candidate_id,
    handle: row.handle,
    displayName: row.display_name,
    avatarPath: row.avatar_path,
    reasons: rankReasons(terms, MOMENTO_DECK_REASON_LIMIT),
    dreamText: row.dream_text,
  });
}

/**
 * The ≤3 pending proposals, newest DAY first (#273 B: `daily_rank` restarts at 1 every night,
 * so ordering by it alone dealt an arbitrary trio out of every day's rank-1 rows at once).
 *
 * Goes through the get_momenti_deck RPC rather than a client select, for the reason
 * getMomentiSuggestions does: the reasons are computed at read time from the candidate's
 * current tags and `profiles.visibility`, none of which authenticated may read since the M10
 * column grant. The RPC also re-establishes the caller (auth.uid(), never an argument), the
 * block filter both ways, and the dream join that used to be a client-side `.filter()`.
 *
 * `affinity` is not in the projection at all (rule #1) — a card carries a reason KIND.
 */
export async function getMomentiDeck(client: AthanorClient): Promise<MomentoDeckCard[]> {
  const { data, error } = await client.rpc('get_momenti_deck');
  if (error) throw error;
  return (data ?? []).map((r) => rowToDeckCard(r));
}

/**
 * «Ti potrebbe interessare» — up to three affinity-ranked peers (#124), from the member's latest
 * `momento_suggestions` run, in the server's rank order. It used to be ONE peer ranked by dream
 * recency, because the suggestions table was deferred at M5; the chip said «Sogno nuovo» for
 * exactly that reason and now says what the two actually have in common.
 *
 * A member no nightly run has reached yet — a new account before 03:11 UTC, or one for whom
 * nothing scored — still gets one peer, the most recently written visible dream, tagged
 * `newDream`. The section is never empty.
 *
 * Goes through the get_momenti_suggestion RPC rather than a client query, and could not be
 * anything else: `momento_suggestions` carries no client grant at all, and the row needs
 * `profiles.visibility`, which M10 column-scoped away from the client. Blocks, bans, dream
 * visibility and the caller's own id are re-established inside the function at READ time, so a
 * nightly snapshot never outlives a ban — see the migration.
 *
 * `affinity` is not in the projection (rule #3, as on the deck): a row carries reason KINDS.
 */
export async function getMomentiSuggestions(
  client: AthanorClient,
  excludeIds: string[],
): Promise<MomentoSuggestion[]> {
  // No caller id here: the RPC derives it from auth.uid() (rule #8). p_exclude carries only
  // today's deck.
  const { data, error } = await client.rpc('get_momenti_suggestion', { p_exclude: excludeIds });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const parsed = momentoSuggestion.parse({
      candidateId: row.candidate_id,
      handle: row.handle,
      displayName: row.display_name,
      avatarPath: row.avatar_path,
      dreamText: row.dream_text,
      reasons: row.reasons,
    });
    // Ranked AFTER the parse, off validated kinds, so nothing here needs a cast (rules/api.md).
    // Ranked here rather than in SQL because REASON_PRIORITY is one policy in one module and the
    // deck already reads it through this same helper. The server's ROW order is untouched; only
    // the kinds within a row are reordered, so `reasons[0]` is the chip.
    return {
      ...parsed,
      reasons: rankReasons(
        parsed.reasons.map((kind) => ({ kind })),
        parsed.reasons.length,
      ).map((r) => r.kind),
    };
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
