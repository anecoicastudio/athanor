import { describe, expect, it } from 'vitest';
import { t } from '@athanor/i18n';
import { CAST_VOTE_ERROR_COPY, castVoteError } from './vote-error';

describe('CAST_VOTE_ERROR_COPY', () => {
  // The map's keys are `cast_vote`'s own `raise exception` strings, so the copy is only reached
  // if they still read exactly as the migration writes them. Nothing here can assert the SQL
  // (pgTAP 0103 does); what this pins is that the map has no invented codes and no dead rows.
  it('maps exactly the three refusals cast_vote can raise', () => {
    expect(Object.keys(CAST_VOTE_ERROR_COPY).sort()).toEqual([
      'auth required',
      'candidacy not votable',
      'voting closed',
    ]);
  });

  it('resolves every branch to real copy in both locales', () => {
    const keys = [...Object.values(CAST_VOTE_ERROR_COPY), castVoteError(null).key];
    for (const key of keys) {
      expect(t(key, 'it')).not.toBe(key);
      expect(t(key, 'en')).not.toBe(key);
    }
  });
});

describe('castVoteError', () => {
  it('names the window refusal and marks the cached edition stale', () => {
    expect(castVoteError({ message: 'voting closed', code: 'P0001' })).toEqual({
      key: 'fund.vote.error.closed',
      editionStale: true,
    });
  });

  // A candidacy leaving the ballot says nothing about the edition — the ballot list is what
  // went stale. Re-reading the edition on this would flip a correct screen for no reason.
  it('names the ballot refusal without touching the edition', () => {
    expect(castVoteError({ message: 'candidacy not votable', code: 'P0001' })).toEqual({
      key: 'fund.vote.error.notVotable',
      editionStale: false,
    });
  });

  it('names the auth refusal without touching the edition', () => {
    expect(castVoteError({ message: 'auth required', code: '42501' })).toEqual({
      key: 'fund.vote.error.auth',
      editionStale: false,
    });
  });

  // The generic key exists so that a refusal this build does not know still SAYS something.
  // Silence is the defect this whole path was opened for (#382): the member tapped, the
  // optimistic flip rolled back, and nothing explained it.
  it('degrades an unmapped refusal to the generic failure, never to silence', () => {
    expect(castVoteError({ message: 'quorum not met', code: 'P0001' })).toEqual({
      key: 'fund.vote.error',
      editionStale: false,
    });
  });

  it('degrades a transport failure to the generic failure', () => {
    expect(castVoteError(new Error('Network request failed'))).toEqual({
      key: 'fund.vote.error',
      editionStale: false,
    });
  });

  it('degrades anything that is not an error object at all', () => {
    for (const thrown of [null, undefined, 'voting closed', 42, {}, { message: 7 }]) {
      expect(castVoteError(thrown)).toEqual({ key: 'fund.vote.error', editionStale: false });
    }
  });
});
