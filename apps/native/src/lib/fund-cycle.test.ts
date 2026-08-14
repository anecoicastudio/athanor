import { describe, expect, it } from 'vitest';
import { annualFundBody, dreamHeroSlot, fundCycleState, type FundCycleState } from './fund-cycle';

const EDITION = { id: 'e1', phase: 'community' };

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
