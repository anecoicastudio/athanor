import { describe, expect, it, vi } from 'vitest';
import type { AthanorClient } from './client';
import { castVote, getEditionTally, getMyVote, voteKeys } from './votes';

const EDITION = '00000000-0000-0000-0000-0000000000e1';
const CANDIDACY = '00000000-0000-0000-0000-0000000000c1';
const VOTER = '00000000-0000-0000-0000-000000000001';

/** A candidacy_votes row as PostgREST returns it — weight arrives as a numeric string. */
const VOTE_ROW = {
  id: '00000000-0000-0000-0000-0000000000d1',
  edition_id: EDITION,
  candidacy_id: CANDIDACY,
  voter_id: VOTER,
  weight: '1.500',
  created_at: '2026-01-02T00:00:00Z',
};

/** Thenable PostgREST-builder stub: records calls; maybeSingle() resolves { data, error }. */
function stub(row: Record<string, unknown> | null = null, error: unknown = null) {
  const calls: Array<{ method: string; arg: unknown; arg2?: unknown }> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) {
    chain[m] = (arg?: unknown, arg2?: unknown) => {
      calls.push({ method: m, arg, arg2 });
      return chain;
    };
  }
  chain['maybeSingle'] = () => {
    calls.push({ method: 'maybeSingle', arg: undefined });
    return Promise.resolve({ data: row, error });
  };
  const client = { from: () => chain } as unknown as AthanorClient;
  return { client, calls };
}

describe('voteKeys', () => {
  it('scopes mine + tally by edition under the votes root', () => {
    expect(voteKeys.all).toEqual(['votes']);
    expect(voteKeys.mine(EDITION)).toEqual(['votes', 'mine', EDITION]);
    expect(voteKeys.tally(EDITION)).toEqual(['votes', 'tally', EDITION]);
  });
});

describe('getMyVote', () => {
  it('filters by edition_id + voter_id and uses maybeSingle', async () => {
    const { client, calls } = stub();
    await getMyVote(client, EDITION, VOTER);
    expect(
      calls.some((c) => c.method === 'eq' && c.arg === 'edition_id' && c.arg2 === EDITION),
    ).toBe(true);
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'voter_id' && c.arg2 === VOTER)).toBe(
      true,
    );
    expect(calls.some((c) => c.method === 'maybeSingle')).toBe(true);
  });

  it('passes null through when no vote exists', async () => {
    const { client } = stub(null);
    await expect(getMyVote(client, EDITION, VOTER)).resolves.toBeNull();
  });

  it('parses the row (weight numeric-string coerced to number)', async () => {
    const { client } = stub(VOTE_ROW);
    const vote = await getMyVote(client, EDITION, VOTER);
    expect(vote?.weight).toBe(1.5);
    expect(vote?.candidacy_id).toBe(CANDIDACY);
  });

  it('throws on error', async () => {
    const { client } = stub(null, new Error('boom'));
    await expect(getMyVote(client, EDITION, VOTER)).rejects.toThrow('boom');
  });
});

describe('getEditionTally', () => {
  it('calls the candidacy_tally rpc and parses rows (bigint/numeric strings)', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ candidacy_id: CANDIDACY, vote_count: '3', weighted_total: '4.250' }],
      error: null,
    });
    const client = { rpc } as unknown as AthanorClient;
    const rows = await getEditionTally(client, EDITION);
    expect(rpc).toHaveBeenCalledWith('candidacy_tally', { p_edition_id: EDITION });
    expect(rows).toEqual([{ candidacy_id: CANDIDACY, vote_count: 3, weighted_total: 4.25 }]);
  });

  it('returns [] when data is null', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { rpc } as unknown as AthanorClient;
    await expect(getEditionTally(client, EDITION)).resolves.toEqual([]);
  });

  it('throws on rpc error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error('boom') });
    const client = { rpc } as unknown as AthanorClient;
    await expect(getEditionTally(client, EDITION)).rejects.toThrow('boom');
  });
});

describe('castVote', () => {
  it('calls the cast_vote rpc with mapped params and resolves void', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const client = { rpc } as unknown as AthanorClient;
    await expect(
      castVote(client, { editionId: EDITION, candidacyId: CANDIDACY }),
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('cast_vote', {
      p_edition_id: EDITION,
      p_candidacy_id: CANDIDACY,
    });
  });

  it('throws on rpc error', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: new Error('window closed') });
    const client = { rpc } as unknown as AthanorClient;
    await expect(castVote(client, { editionId: EDITION, candidacyId: CANDIDACY })).rejects.toThrow(
      'window closed',
    );
  });
});
