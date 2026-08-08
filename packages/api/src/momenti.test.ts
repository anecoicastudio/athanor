import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import { getMomentiSuggestion, momentiKeys, rowToDeckCard } from './momenti';

describe('momentiKeys', () => {
  it('builds stable keys', () => {
    expect(momentiKeys.deck()).toEqual(['momenti', 'deck']);
    expect(momentiKeys.suggestions()).toEqual(['momenti', 'suggestions']);
  });
});

describe('rowToDeckCard', () => {
  it('maps a joined proposal row to a deck card', () => {
    const card = rowToDeckCard({
      id: '11111111-1111-1111-1111-111111111111',
      candidate_id: '33333333-3333-3333-3333-333333333333',
      reasons: ['Condividete: design'],
      status: 'pending',
      candidate: { handle: 'maria', dreams: [{ text: 'Aprire uno studio' }] },
    });
    expect(card).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      candidateId: '33333333-3333-3333-3333-333333333333',
      handle: 'maria',
      reasons: ['Condividete: design'],
      dreamText: 'Aprire uno studio',
      status: 'pending',
    });
  });

  it('tolerates a peer with no active dream', () => {
    const card = rowToDeckCard({
      id: '11111111-1111-1111-1111-111111111111',
      candidate_id: '33333333-3333-3333-3333-333333333333',
      reasons: [],
      status: 'pending',
      candidate: { handle: 'leo', dreams: [] },
    });
    expect(card.dreamText).toBeNull();
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

describe('getMomentiSuggestion (get_momenti_suggestion RPC)', () => {
  const row = {
    candidate_id: '44444444-4444-4444-4444-444444444444',
    handle: 'giulia',
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
