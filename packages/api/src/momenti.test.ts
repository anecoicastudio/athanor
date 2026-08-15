import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import { getMomentiDeck, getMomentiSuggestion, momentiKeys, rowToDeckCard } from './momenti';

describe('momentiKeys', () => {
  it('builds stable keys', () => {
    expect(momentiKeys.deck()).toEqual(['momenti', 'deck']);
    expect(momentiKeys.suggestions()).toEqual(['momenti', 'suggestions']);
  });
});

describe('rowToDeckCard', () => {
  const row = {
    proposal_id: '11111111-1111-1111-1111-111111111111',
    candidate_id: '33333333-3333-3333-3333-333333333333',
    handle: 'maria',
    display_name: 'Maria Neri',
    avatar_path: 'ma/ma.jpg',
    dream_text: 'Aprire uno studio',
    reason_kind: 'affinity',
    shared: ['creativo'],
    seek_hit: ['mentor'],
    offer_hit: ['investitore'],
    skills_shared: ['branding', 'sviluppo-web'],
    city_near: ['Milano'],
    mutual_activity: ['Cena sotto le stelle'],
    profession_pair: ['design', 'sviluppo'],
  };

  it('maps an RPC row to a deck card of structured reasons', () => {
    expect(rowToDeckCard(row)).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      candidateId: '33333333-3333-3333-3333-333333333333',
      handle: 'maria',
      displayName: 'Maria Neri',
      avatarPath: 'ma/ma.jpg',
      dreamText: 'Aprire uno studio',
      reasons: [
        { kind: 'shared', tags: ['creativo'] },
        { kind: 'seeking', tags: ['mentor'] },
        { kind: 'offering', tags: ['investitore'] },
        { kind: 'skills', tags: ['branding', 'sviluppo-web'] },
        { kind: 'city', tags: ['Milano'] },
        { kind: 'mutualActivity', tags: ['Cena sotto le stelle'] },
        { kind: 'profession', tags: ['design', 'sviluppo'] },
      ],
    });
  });

  // The reasons are TAG KEYS now, not prose (#273 D) — the card localizes them. A term
  // that survived the server's masking as [] must not render an empty «Condividete:».
  it('drops a term the candidate has masked to nothing', () => {
    const card = rowToDeckCard({
      ...row,
      seek_hit: [],
      offer_hit: [],
      skills_shared: [],
      city_near: [],
      mutual_activity: [],
      profession_pair: [],
    });
    expect(card.reasons).toEqual([{ kind: 'shared', tags: ['creativo'] }]);
  });

  it('leaves no reason at all when every term is masked', () => {
    const card = rowToDeckCard({
      ...row,
      shared: [],
      seek_hit: [],
      offer_hit: [],
      skills_shared: [],
      city_near: [],
      mutual_activity: [],
      profession_pair: [],
    });
    expect(card.reasons).toEqual([]);
  });

  // #273 E: the dream-recency fallback claims no affinity, so it says «Sogno nuovo» —
  // the honest label, following get_momenti_suggestion's precedent.
  it('renders a fallback card as a single new-dream reason', () => {
    const card = rowToDeckCard({ ...row, reason_kind: 'new_dream' });
    expect(card.reasons).toEqual([{ kind: 'newDream', tags: [] }]);
  });

  it('never carries an affinity score (rule #1)', () => {
    // The RPC returns a KIND, never the number; if a future row ever ships `affinity`,
    // the parse must not pass it through to a client that could render it.
    const card = rowToDeckCard({ ...row, affinity: 7 });
    expect(Object.keys(card)).not.toContain('affinity');
  });
});

/**
 * `rpc()` stub — resolves directly to `{ data, error }` (getMomentiSuggestion awaits the rpc
 * call itself, unlike getProfileById which chains `.maybeSingle()`).
 *
 * Deliberately provides no `auth` object: the previous implementation called
 * `client.auth.getUser()` to prepend the caller's own id, and the RPC now derives that from
 * `auth.uid()` (rule #8). If that call is ever reintroduced these tests throw rather than
 * silently pass.
 */
function rpcStub(data: unknown, error: unknown = null) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  return {
    calls,
    client: {
      rpc: (fn: string, args: unknown) => {
        calls.push({ fn, args });
        return Promise.resolve({ data, error });
      },
    } as unknown as AthanorClient,
  };
}

describe('getMomentiDeck (get_momenti_deck RPC)', () => {
  const row = {
    proposal_id: '11111111-1111-1111-1111-111111111111',
    candidate_id: '33333333-3333-3333-3333-333333333333',
    handle: 'maria',
    display_name: null,
    avatar_path: null,
    dream_text: 'Aprire uno studio',
    reason_kind: 'affinity',
    shared: ['creativo'],
    seek_hit: [],
    offer_hit: [],
    skills_shared: [],
    city_near: [],
    mutual_activity: [],
    profession_pair: [],
  };

  it('takes no argument — the caller comes from auth.uid() (rule #8)', async () => {
    const { client, calls } = rpcStub([row]);
    await getMomentiDeck(client);
    expect(calls).toEqual([{ fn: 'get_momenti_deck', args: undefined }]);
  });

  it('keeps the server order — Home and the tab must deal the same top card', async () => {
    const second = { ...row, proposal_id: '22222222-2222-2222-2222-222222222222' };
    const { client } = rpcStub([row, second]);
    const cards = await getMomentiDeck(client);
    expect(cards.map((c) => c.id)).toEqual([row.proposal_id, second.proposal_id]);
  });

  it('returns an empty deck rather than null when nothing waits', async () => {
    const { client } = rpcStub(null);
    expect(await getMomentiDeck(client)).toEqual([]);
  });

  it('throws the RPC error rather than showing an empty deck', async () => {
    const { client } = rpcStub(null, { message: 'permission denied' });
    await expect(getMomentiDeck(client)).rejects.toEqual({ message: 'permission denied' });
  });
});

describe('getMomentiSuggestion (get_momenti_suggestion RPC)', () => {
  const row = {
    candidate_id: '44444444-4444-4444-4444-444444444444',
    handle: 'giulia',
    display_name: 'Giulia Sole',
    avatar_path: 'g/g.jpg',
    dream_text: 'Aprire una scuola di liuteria',
  };

  it('passes only the deck ids as p_exclude — never the caller', async () => {
    const { client, calls } = rpcStub([row]);
    await getMomentiSuggestion(client, ['deck-1', 'deck-2']);
    expect(calls).toEqual([
      { fn: 'get_momenti_suggestion', args: { p_exclude: ['deck-1', 'deck-2'] } },
    ]);
  });

  it('maps the snake_case row onto the suggestion shape', async () => {
    const { client } = rpcStub([row]);
    expect(await getMomentiSuggestion(client, [])).toEqual({
      candidateId: row.candidate_id,
      handle: row.handle,
      displayName: row.display_name,
      avatarPath: row.avatar_path,
      dreamText: row.dream_text,
    });
  });

  it('returns null when the RPC finds nobody', async () => {
    const { client } = rpcStub([]);
    expect(await getMomentiSuggestion(client, [])).toBeNull();
  });

  it('throws the RPC error rather than swallowing it into an empty section', async () => {
    const { client } = rpcStub(null, { message: 'permission denied' });
    await expect(getMomentiSuggestion(client, [])).rejects.toEqual({
      message: 'permission denied',
    });
  });
});
