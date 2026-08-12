import { describe, expect, it } from 'vitest';
import { listState } from './list-state';

/** Every combination the TanStack v5 pair can actually take. */
const STATUSES = ['pending', 'error', 'success'] as const;
const FETCH_STATUSES = ['fetching', 'paused', 'idle'] as const;

/** `staleWins` is required at the call site; a list has rows worth keeping on screen. */
const asList = { staleWins: true } as const;
/** Aura-flavoured surfaces: a stale number is a claim about a person's worth. */
const asOwnAura = { staleWins: false } as const;

describe('listState', () => {
  it('says empty only when a settled read genuinely returned nothing', () => {
    expect(listState({ status: 'success', fetchStatus: 'idle', isEmpty: true, ...asList })).toBe(
      'empty',
    );
  });

  it('says error, not empty, when the read threw', () => {
    // The bug, in one line: every screen rendered its empty copy here, so «Non hai bloccato
    // nessuno» was what a failed block-list read said out loud.
    expect(listState({ status: 'error', fetchStatus: 'idle', isEmpty: true, ...asList })).toBe(
      'error',
    );
  });

  it('says loading while a read is genuinely in flight', () => {
    expect(
      listState({ status: 'pending', fetchStatus: 'fetching', isEmpty: true, ...asList }),
    ).toBe('loading');
  });

  it('separates a DISABLED query from a pending one', () => {
    // The trap #10 paid for: `isLoading` is `isPending && isFetching` in v5, so a query with
    // `enabled: !!userId` reports isLoading FALSE with no data while the session hydrates —
    // and every screen that gated on it fell straight through to the empty branch. `isPending`
    // (what `weekSlotState` keyed on before it folded in here) covers both; the
    // status/fetchStatus pair goes one further and lets a caller render nothing at all for a
    // query that never started, rather than ghosts for a fetch that is not happening.
    expect(listState({ status: 'pending', fetchStatus: 'idle', isEmpty: true, ...asList })).toBe(
      'idle',
    );
    expect(
      listState({ status: 'pending', fetchStatus: 'fetching', isEmpty: true, ...asList }),
    ).toBe('loading');
  });

  it('treats a paused (offline) fetch as loading, not as absence', () => {
    // fetchStatus 'paused' means the query wants to run and the network is gone. It has not
    // failed and it has not returned nothing — saying either would be a false claim.
    expect(listState({ status: 'pending', fetchStatus: 'paused', isEmpty: true, ...asList })).toBe(
      'loading',
    );
  });

  it('says ready as soon as there are rows', () => {
    expect(listState({ status: 'success', fetchStatus: 'idle', isEmpty: false, ...asList })).toBe(
      'ready',
    );
  });

  it('never says empty while the read could still produce rows', () => {
    // The property the eleven screens lacked. `empty` is a claim about the data, and it may
    // only be made once a read has settled successfully.
    for (const status of STATUSES) {
      for (const fetchStatus of FETCH_STATUSES) {
        if (status === 'success') continue;
        for (const staleWins of [true, false]) {
          expect(listState({ status, fetchStatus, isEmpty: true, staleWins })).not.toBe('empty');
        }
      }
    }
  });

  it('distinguishes error from empty — the direction, not just the values', () => {
    // A mutant collapsing the two would keep every single-case assertion above passing for
    // one of the two arms.
    expect(listState({ status: 'error', fetchStatus: 'idle', isEmpty: true, ...asList })).not.toBe(
      listState({ status: 'success', fetchStatus: 'idle', isEmpty: true, ...asList }),
    );
  });

  it('is total — every input combination resolves to one of the five states', () => {
    const states = ['idle', 'loading', 'error', 'empty', 'ready'];
    for (const status of STATUSES) {
      for (const fetchStatus of FETCH_STATUSES) {
        for (const isEmpty of [true, false]) {
          for (const staleWins of [true, false]) {
            expect(states).toContain(listState({ status, fetchStatus, isEmpty, staleWins }));
          }
        }
      }
    }
  });
});

// `staleWins` is the ONE axis the two callers disagreed on before `weekSlotState` folded in
// here (#279 wrote it as `isError` first; the lists wrote it as content first). Both were
// deliberate. `MomentiCard.tsx:41-44` states the dividing line: a stale Aura number is a claim
// about a person's worth, a stale proposal costs one wasted tap.
describe('listState — stale content versus a failed refetch', () => {
  it('keeps rows on screen when staleWins, so a list never blanks under a bad refresh', () => {
    expect(listState({ status: 'error', fetchStatus: 'idle', isEmpty: false, ...asList })).toBe(
      'ready',
    );
  });

  it('lets the error win otherwise, which is what the week slot chose', () => {
    // The query client persists to AsyncStorage with a 24h gcTime and Aura decays, so
    // yesterday's number presented as today's is the false confidence `aura-display.ts`
    // already refused for the score. This was `weekSlotState`'s first branch.
    expect(listState({ status: 'error', fetchStatus: 'idle', isEmpty: false, ...asOwnAura })).toBe(
      'error',
    );
  });

  it('governs the error case and NOTHING else', () => {
    // A background refetch over cached rows shows the rows either way, and `weekSlotState`
    // agreed — `isPending` is false once a first fetch has succeeded. If this ever diverged,
    // a member watching a list would see it flash to ghosts on every poll.
    for (const staleWins of [true, false]) {
      expect(
        listState({ status: 'pending', fetchStatus: 'fetching', isEmpty: false, staleWins }),
      ).toBe('ready');
      expect(listState({ status: 'success', fetchStatus: 'idle', isEmpty: false, staleWins })).toBe(
        'ready',
      );
    }
  });

  it('is irrelevant when there is nothing cached to keep', () => {
    for (const staleWins of [true, false]) {
      expect(listState({ status: 'error', fetchStatus: 'idle', isEmpty: true, staleWins })).toBe(
        'error',
      );
    }
  });
});

// The four cases `weekSlotState` (deleted from lib/week-slot.ts) asserted, restated in the
// vocabulary that replaced it: 'pending' → 'loading' | 'idle', 'data' → 'ready'. Kept so the
// fold cannot quietly drop a property #279 had paid for.
describe('listState — the week slot cases, after the fold', () => {
  it('separates the three non-answers that used to share one «Presto qui» card', () => {
    expect(
      listState({ status: 'pending', fetchStatus: 'fetching', isEmpty: true, ...asOwnAura }),
    ).toBe('loading');
    expect(listState({ status: 'error', fetchStatus: 'idle', isEmpty: true, ...asOwnAura })).toBe(
      'error',
    );
    expect(listState({ status: 'success', fetchStatus: 'idle', isEmpty: true, ...asOwnAura })).toBe(
      'empty',
    );
  });

  it('renders the card once there is something to show', () => {
    expect(
      listState({ status: 'success', fetchStatus: 'idle', isEmpty: false, ...asOwnAura }),
    ).toBe('ready');
  });

  it('never lets an idle, never-started query pass for an answer', () => {
    // `enabled: !!userId` holds the query while the session hydrates. `weekSlotState` folded
    // this into 'pending'; here it is its own arm, and the caller renders the same ghosts for
    // both. What must not happen — and what the original bug was — is it reaching 'empty'.
    const state = listState({
      status: 'pending',
      fetchStatus: 'idle',
      isEmpty: true,
      ...asOwnAura,
    });
    expect(state).toBe('idle');
    expect(state).not.toBe('empty');
  });
});
