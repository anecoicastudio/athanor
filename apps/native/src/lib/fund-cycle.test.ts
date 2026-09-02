import { describe, expect, it } from 'vitest';
import type { FundPhase } from '@athanor/schemas';
import {
  annualFundBody,
  ballotVoteState,
  candidacyBallotOpen,
  detailVoteState,
  dreamHeroSlot,
  fundCycleState,
  type FundCycleState,
} from './fund-cycle';

const EDITION = { id: 'e1', phase: 'voting' };

describe('fundCycleState', () => {
  it('first load in flight is pending — the announcement must not flash (issue #224)', () => {
    expect(fundCycleState({ status: 'pending', fetchStatus: 'fetching', edition: undefined })).toBe(
      'pending',
    );
  });

  it('a disabled/idle query is pending, not noCycle (the #10 hydration hole)', () => {
    expect(fundCycleState({ status: 'pending', fetchStatus: 'idle', edition: undefined })).toBe(
      'pending',
    );
  });

  it('offline-paused is pending — neither failed nor settled empty', () => {
    expect(fundCycleState({ status: 'pending', fetchStatus: 'paused', edition: undefined })).toBe(
      'pending',
    );
  });

  it('a failed read is error, never noCycle — a network error is not «no cycle»', () => {
    expect(fundCycleState({ status: 'error', fetchStatus: 'idle', edition: undefined })).toBe(
      'error',
    );
  });

  it('a failed refetch over a cached edition keeps the edition (staleWins)', () => {
    expect(fundCycleState({ status: 'error', fetchStatus: 'idle', edition: EDITION })).toBe(
      'active',
    );
  });

  it('only a settled empty read is noCycle — the announcement is a confirmed answer', () => {
    expect(fundCycleState({ status: 'success', fetchStatus: 'idle', edition: null })).toBe(
      'noCycle',
    );
  });

  it('a settled edition is active', () => {
    expect(fundCycleState({ status: 'success', fetchStatus: 'idle', edition: EDITION })).toBe(
      'active',
    );
  });
});

describe('dreamHeroSlot (Home surface)', () => {
  it('collapses while pending and on error — never the announcement, never «Presto qui»', () => {
    expect(dreamHeroSlot('pending')).toBe('collapse');
    expect(dreamHeroSlot('error')).toBe('collapse');
  });

  it('announces on a confirmed no-cycle and renders the card when a cycle is open', () => {
    expect(dreamHeroSlot('noCycle')).toBe('announce');
    expect(dreamHeroSlot('active')).toBe('card');
  });
});

describe('annualFundBody (fund modal surface)', () => {
  it('owns every state: spinner, retryable error, announcement, live', () => {
    expect(annualFundBody('pending')).toBe('loading');
    expect(annualFundBody('error')).toBe('error');
    expect(annualFundBody('noCycle')).toBe('announce');
    expect(annualFundBody('active')).toBe('live');
  });

  it('no state renders the live ticker without an open cycle (never €0, FUND-47)', () => {
    const states: FundCycleState[] = ['pending', 'error', 'noCycle'];
    for (const s of states) expect(annualFundBody(s)).not.toBe('live');
  });
});

// ── The candidacy detail screen's ballot rule (#382) ──────────────────────────────────────
// That screen never queried the edition at all, so its `votingClosed` state was unreachable
// while its docblock claimed it rendered «the same Vota/Votato/Voto-chiuso as the card».

const STARTS = '2026-03-01T00:00:00.000Z';
const ENDS = '2026-03-08T00:00:00.000Z';
const STARTS_MS = Date.parse(STARTS);
const ENDS_MS = Date.parse(ENDS);
const OPEN_EDITION = {
  id: 'e1',
  phase: 'voting' as FundPhase,
  voting_starts_at: STARTS as string | null,
  voting_ends_at: ENDS as string | null,
};

describe('candidacyBallotOpen', () => {
  it("is the core rule when the active edition is this candidacy's own cycle", () => {
    expect(
      candidacyBallotOpen({
        status: 'success',
        edition: OPEN_EDITION,
        candidacyEditionId: 'e1',
        nowMs: STARTS_MS + 1,
      }),
    ).toBe(true);
    expect(
      candidacyBallotOpen({
        status: 'success',
        edition: OPEN_EDITION,
        candidacyEditionId: 'e1',
        nowMs: ENDS_MS + 1,
      }),
    ).toBe(false);
  });

  // #414's live shape, reached through this screen: phase 'voting', both bounds NULL.
  it('is closed when the window was never published', () => {
    expect(
      candidacyBallotOpen({
        status: 'success',
        edition: { ...OPEN_EDITION, voting_starts_at: null, voting_ends_at: null },
        candidacyEditionId: 'e1',
        nowMs: STARTS_MS + 1,
      }),
    ).toBe(false);
  });

  // A deep link can land on a candidacy from a cycle that is no longer the active one — there
  // is no by-id edition read, so the only honest answer is «not this ballot».
  it('is closed when the active cycle is a different one', () => {
    expect(
      candidacyBallotOpen({
        status: 'success',
        edition: OPEN_EDITION,
        candidacyEditionId: 'e2',
        nowMs: STARTS_MS + 1,
      }),
    ).toBe(false);
  });

  it('is closed on a settled read with no active cycle at all', () => {
    expect(
      candidacyBallotOpen({
        status: 'success',
        edition: null,
        candidacyEditionId: 'e1',
        nowMs: STARTS_MS + 1,
      }),
    ).toBe(false);
  });

  // Unknown, NOT closed: «Voto chiuso» asserted while the answer is still on its way is the
  // same false-claim shape as the flashed announcement fundCycleState exists to prevent, and a
  // failed edition read is not evidence the ballot shut.
  it('is unknown while the read is in flight or has failed', () => {
    for (const status of ['pending', 'error'] as const) {
      expect(
        candidacyBallotOpen({
          status,
          edition: null,
          candidacyEditionId: 'e1',
          nowMs: STARTS_MS + 1,
        }),
      ).toBeNull();
      // Even with a cached edition in hand: the status is what decides whether to assert.
      expect(
        candidacyBallotOpen({
          status,
          edition: OPEN_EDITION,
          candidacyEditionId: 'e1',
          nowMs: ENDS_MS + 1,
        }),
      ).toBeNull();
    }
  });
});

describe('detailVoteState', () => {
  it('says the ballot is shut before anything else, exactly as the card does', () => {
    expect(
      detailVoteState({ ballotOpen: false, pending: true, votedThis: true, votedElsewhere: false }),
    ).toBe('votingClosed');
  });

  it('shows the in-flight vote, then the recorded one', () => {
    expect(
      detailVoteState({ ballotOpen: true, pending: true, votedThis: false, votedElsewhere: false }),
    ).toBe('voting');
    expect(
      detailVoteState({ ballotOpen: true, pending: false, votedThis: true, votedElsewhere: false }),
    ).toBe('voted');
    expect(
      detailVoteState({
        ballotOpen: true,
        pending: false,
        votedThis: false,
        votedElsewhere: false,
      }),
    ).toBe('notVoted');
  });

  // #633: a vote held on ANOTHER candidacy makes this screen's action a move, and the label
  // must say so — «Vota» here would promise a second vote cast_vote refuses.
  it('names the move when the vote is held elsewhere, but never over a shut ballot', () => {
    expect(
      ballotVoteState({
        isWinner: false,
        ballotOpen: true,
        pending: false,
        votedThis: false,
        votedElsewhere: true,
      }),
    ).toBe('voteElsewhere');
    expect(
      detailVoteState({ ballotOpen: true, pending: false, votedThis: false, votedElsewhere: true }),
    ).toBe('voteElsewhere');
    expect(
      detailVoteState({
        ballotOpen: false,
        pending: false,
        votedThis: false,
        votedElsewhere: true,
      }),
    ).toBe('votingClosed');
  });

  // An unknown ballot keeps the pre-#382 behaviour rather than asserting closure: the action
  // stays live, and a refusal now reaches the member as copy instead of as silence.
  it('treats an unknown ballot as it treats an open one', () => {
    expect(
      detailVoteState({
        ballotOpen: null,
        pending: false,
        votedThis: false,
        votedElsewhere: false,
      }),
    ).toBe('notVoted');
    expect(
      detailVoteState({ ballotOpen: null, pending: false, votedThis: true, votedElsewhere: false }),
    ).toBe('voted');
    expect(
      detailVoteState({ ballotOpen: null, pending: true, votedThis: false, votedElsewhere: false }),
    ).toBe('voting');
  });
});

describe('ballotVoteState', () => {
  // The list's one extra state: a declared winner outranks EVERYTHING, a shut ballot
  // included — the edition is over and this card is why.
  it('puts the winner ribbon above every other state', () => {
    expect(
      ballotVoteState({
        isWinner: true,
        ballotOpen: false,
        pending: true,
        votedThis: true,
        votedElsewhere: false,
      }),
    ).toBe('winner');
  });

  it('otherwise answers exactly as the detail does', () => {
    expect(
      ballotVoteState({
        isWinner: false,
        ballotOpen: false,
        pending: false,
        votedThis: false,
        votedElsewhere: true,
      }),
    ).toBe('votingClosed');
    expect(
      ballotVoteState({
        isWinner: false,
        ballotOpen: null,
        pending: false,
        votedThis: false,
        votedElsewhere: false,
      }),
    ).toBe('notVoted');
  });
});
