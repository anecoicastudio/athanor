import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import {
  getMomentiDeck,
  getMomentiSuggestions,
  hasAnsweredMomento,
  momentiKeys,
  rowToDeckCard,
} from './momenti';
import { DB_DOWN, asClient, makeFakeClient } from './test-support/fake-client';

describe('momentiKeys', () => {
  it('builds stable keys', () => {
    expect(momentiKeys.deck()).toEqual(['momenti', 'deck']);
    expect(momentiKeys.suggestions()).toEqual(['momenti', 'suggestions']);
    expect(momentiKeys.answered()).toEqual(['momenti', 'answered']);
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

  // All seven terms fired, and a card has room for three: the row above is exactly the
  // case #384 was opened on. The three that survive are the ranked ones (`rankReasons`),
  // not the first three the RPC listed — which used to be shared/seeking/offering every
  // single time, so verified co-attendance and a complementary craft never showed at all.
  it('maps an RPC row to a deck card of ranked, capped reasons', () => {
    expect(rowToDeckCard(row)).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      candidateId: '33333333-3333-3333-3333-333333333333',
      handle: 'maria',
      displayName: 'Maria Neri',
      avatarPath: 'ma/ma.jpg',
      dreamText: 'Aprire uno studio',
      reasons: [
        { kind: 'mutualActivity', tags: ['Cena sotto le stelle'] },
        { kind: 'profession', tags: ['design', 'sviluppo'] },
        { kind: 'seeking', tags: ['mentor'] },
      ],
    });
  });

  it('drops the ambient term first when four fired and three fit', () => {
    // «Vicino a te» is the lowest-priority term — a fact about geography, not about
    // them — so it is the one that yields when the card runs out of room.
    const card = rowToDeckCard({ ...row, seek_hit: [], offer_hit: [], skills_shared: [] });
    expect(card.reasons).toEqual([
      { kind: 'mutualActivity', tags: ['Cena sotto le stelle'] },
      { kind: 'profession', tags: ['design', 'sviluppo'] },
      { kind: 'shared', tags: ['creativo'] },
    ]);
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
 * `rpc()` stub — resolves directly to `{ data, error }` (getMomentiSuggestions awaits the rpc
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

describe('getMomentiSuggestions (get_momenti_suggestion RPC)', () => {
  const row = {
    candidate_id: '44444444-4444-4444-4444-444444444444',
    handle: 'giulia',
    display_name: 'Giulia Sole',
    avatar_path: 'g/g.jpg',
    dream_text: 'Aprire una scuola di liuteria',
    reasons: ['skills'],
  };

  it('passes only the deck ids as p_exclude — never the caller', async () => {
    const { client, calls } = rpcStub([row]);
    await getMomentiSuggestions(client, ['deck-1', 'deck-2']);
    expect(calls).toEqual([
      { fn: 'get_momenti_suggestion', args: { p_exclude: ['deck-1', 'deck-2'] } },
    ]);
  });

  it('maps the snake_case row onto the suggestion shape', async () => {
    const { client } = rpcStub([row]);
    expect(await getMomentiSuggestions(client, [])).toEqual([
      {
        candidateId: row.candidate_id,
        handle: row.handle,
        displayName: row.display_name,
        avatarPath: row.avatar_path,
        dreamText: row.dream_text,
        reasons: ['skills'],
      },
    ]);
  });

  it('keeps the server RANK order — the list is curated, not sorted client-side', async () => {
    const second = { ...row, candidate_id: '55555555-5555-5555-5555-555555555555' };
    const { client } = rpcStub([row, second]);
    const list = await getMomentiSuggestions(client, []);
    expect(list.map((s) => s.candidateId)).toEqual([row.candidate_id, second.candidate_id]);
  });

  it('ranks the kinds WITHIN a row by REASON_PRIORITY, so reasons[0] is the chip', async () => {
    // Wire order is momento_terms() column order — `shared` before `mutualActivity`. The
    // hardest-earned term has to come out first, or the chip shows the commonest one there is.
    const { client } = rpcStub([{ ...row, reasons: ['shared', 'city', 'mutualActivity'] }]);
    const [suggestion] = await getMomentiSuggestions(client, []);
    expect(suggestion?.reasons).toEqual(['mutualActivity', 'shared', 'city']);
  });

  it('drops nothing while reordering — every kind the server sent survives', async () => {
    const { client } = rpcStub([{ ...row, reasons: ['shared', 'city', 'mutualActivity'] }]);
    const [suggestion] = await getMomentiSuggestions(client, []);
    expect([...(suggestion?.reasons ?? [])].sort()).toEqual(['city', 'mutualActivity', 'shared']);
  });

  it('returns an empty list rather than null when the RPC finds nobody', async () => {
    const { client } = rpcStub([]);
    expect(await getMomentiSuggestions(client, [])).toEqual([]);
  });

  it('never exposes affinity, even when the RPC starts sending one', async () => {
    const { client } = rpcStub([{ ...row, affinity: 9 }]);
    const list = await getMomentiSuggestions(client, []);
    expect(list).toHaveLength(1);
    // The whole key set, not just the absence: `not.toContain` on an empty object would pass.
    expect(Object.keys(list[0] ?? {}).sort()).toEqual([
      'avatarPath',
      'candidateId',
      'displayName',
      'dreamText',
      'handle',
      'reasons',
    ]);
  });

  it('throws the RPC error rather than swallowing it into an empty section', async () => {
    const { client } = rpcStub(null, { message: 'permission denied' });
    await expect(getMomentiSuggestions(client, [])).rejects.toEqual({
      message: 'permission denied',
    });
  });
});

describe('hasAnsweredMomento', () => {
  const answeredRow = { id: '11111111-1111-1111-1111-111111111111' };

  it('asks only whether an ANSWERED row exists — never how many (rule #3)', async () => {
    const fake = makeFakeClient({ 'momento_proposals.select': [{ data: [answeredRow] }] });
    await hasAnsweredMomento(asClient(fake));
    const call = fake.calls[0]!;
    expect(call.table).toBe('momento_proposals');
    expect(call.op).toBe('select');
    expect(call.filters).toContainEqual(['neq', 'status', 'pending']);
    expect(call.modifiers).toContainEqual(['limit', 1]);
    // No `{ count: 'exact' }`: a Momento count is a vanity metric, and the row's existence
    // is the whole value.
    expect(call.options).toBeUndefined();
  });

  // `affinity` is excluded from the client column grant, so `select('*')` is a 42501 — and the
  // generated Row type lists the column anyway, because types cannot see column ACLs. Only a
  // named projection survives contact with the database.
  it('names its column rather than starring, which the affinity grant would reject', async () => {
    const fake = makeFakeClient({ 'momento_proposals.select': [{ data: [] }] });
    await hasAnsweredMomento(asClient(fake));
    expect(fake.calls[0]?.columns).toBe('id');
  });

  // The subject is the session's, established by `momento_proposals_select_own`
  // (`(select auth.uid()) = user_id`). A client-supplied recipient id would be the shape
  // rule #8 forbids on the server, arriving one layer earlier.
  it('sends no recipient id — RLS scopes the read to the caller', async () => {
    const fake = makeFakeClient({ 'momento_proposals.select': [{ data: [] }] });
    await hasAnsweredMomento(asClient(fake));
    expect(fake.calls[0]?.filters.flat()).not.toContain('user_id');
  });

  it('is true once a single answered row comes back', async () => {
    const fake = makeFakeClient({ 'momento_proposals.select': [{ data: [answeredRow] }] });
    expect(await hasAnsweredMomento(asClient(fake))).toBe(true);
  });

  it('is false for a member who has answered nothing', async () => {
    const fake = makeFakeClient({ 'momento_proposals.select': [{ data: [] }] });
    expect(await hasAnsweredMomento(asClient(fake))).toBe(false);
  });

  it('is false, not a crash, when PostgREST answers with null', async () => {
    const fake = makeFakeClient({ 'momento_proposals.select': [{ data: null }] });
    expect(await hasAnsweredMomento(asClient(fake))).toBe(false);
  });

  // A failed read is the absence of an answer, not an answer (#111 / #594). Swallowing it into
  // `false` would make the never-had-one promise the copy a database outage renders.
  it('rethrows a database failure instead of claiming nothing was ever answered', async () => {
    const fake = makeFakeClient({ 'momento_proposals.select': [{ error: DB_DOWN }] });
    await expect(hasAnsweredMomento(asClient(fake))).rejects.toMatchObject({ code: '57P01' });
  });
});
