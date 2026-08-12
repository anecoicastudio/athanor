import { describe, expect, it } from 'vitest';
import { listState } from './list-state';

/** Every combination the TanStack v5 pair can actually take. */
const STATUSES = ['pending', 'error', 'success'] as const;
const FETCH_STATUSES = ['fetching', 'paused', 'idle'] as const;

describe('listState', () => {
  it('says empty only when a settled read genuinely returned nothing', () => {
    expect(listState({ status: 'success', fetchStatus: 'idle', isEmpty: true })).toBe('empty');
  });

  it('says error, not empty, when the read threw', () => {
    // The bug, in one line: every screen rendered its empty copy here, so «Non hai bloccato
    // nessuno» was what a failed block-list read said out loud.
    expect(listState({ status: 'error', fetchStatus: 'idle', isEmpty: true })).toBe('error');
  });

  it('says loading while a read is genuinely in flight', () => {
    expect(listState({ status: 'pending', fetchStatus: 'fetching', isEmpty: true })).toBe(
      'loading',
    );
  });

  it('separates a DISABLED query from a pending one', () => {
    // The trap #10 paid for: `isLoading` is `isPending && isFetching` in v5, so a query with
    // `enabled: !!userId` reports isLoading FALSE with no data while the session hydrates —
    // and every screen that gated on it fell straight through to the empty branch. Only the
    // status/fetchStatus pair can tell "not started" from "in flight".
    expect(listState({ status: 'pending', fetchStatus: 'idle', isEmpty: true })).toBe('idle');
    expect(listState({ status: 'pending', fetchStatus: 'fetching', isEmpty: true })).toBe(
      'loading',
    );
  });

  it('treats a paused (offline) fetch as loading, not as absence', () => {
    // fetchStatus 'paused' means the query wants to run and the network is gone. It has not
    // failed and it has not returned nothing — saying either would be a false claim.
    expect(listState({ status: 'pending', fetchStatus: 'paused', isEmpty: true })).toBe('loading');
  });

  it('says ready as soon as there are rows', () => {
    expect(listState({ status: 'success', fetchStatus: 'idle', isEmpty: false })).toBe('ready');
  });

  it('keeps rows on screen when a background refetch fails', () => {
    // Same precedence rule as mediaState's cached URL: a list the member is reading must not
    // blank because a refresh lost the network. The rows are still the truest thing we have.
    expect(listState({ status: 'error', fetchStatus: 'idle', isEmpty: false })).toBe('ready');
    expect(listState({ status: 'pending', fetchStatus: 'fetching', isEmpty: false })).toBe('ready');
  });

  it('never says empty while the read could still produce rows', () => {
    // The property the eleven screens lacked. `empty` is a claim about the data, and it may
    // only be made once a read has settled successfully.
    for (const status of STATUSES) {
      for (const fetchStatus of FETCH_STATUSES) {
        if (status === 'success') continue;
        expect(listState({ status, fetchStatus, isEmpty: true })).not.toBe('empty');
      }
    }
  });

  it('distinguishes error from empty — the direction, not just the values', () => {
    // A mutant collapsing the two would keep every single-case assertion above passing for
    // one of the two arms.
    expect(listState({ status: 'error', fetchStatus: 'idle', isEmpty: true })).not.toBe(
      listState({ status: 'success', fetchStatus: 'idle', isEmpty: true }),
    );
  });

  it('is total — every input combination resolves to one of the five states', () => {
    const states = ['idle', 'loading', 'error', 'empty', 'ready'];
    for (const status of STATUSES) {
      for (const fetchStatus of FETCH_STATUSES) {
        for (const isEmpty of [true, false]) {
          expect(states).toContain(listState({ status, fetchStatus, isEmpty }));
        }
      }
    }
  });
});
