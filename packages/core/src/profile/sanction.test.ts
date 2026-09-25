import { describe, expect, it } from 'vitest';
import { sanctionState } from './sanction';

const NOW = new Date('2026-08-13T12:00:00Z').getTime();

describe('sanctionState', () => {
  it('no profile → no sanction (signed out, or still hydrating)', () => {
    expect(sanctionState(null, NOW)).toBeNull();
  });

  it('good standing → null, including when the columns are absent from the projection', () => {
    expect(sanctionState({ suspended_until: null, banned_at: null }, NOW)).toBeNull();
    // The schema marks both optional: third-person projections never carry them.
    expect(sanctionState({}, NOW)).toBeNull();
  });

  it('a future suspended_until is an active suspension and carries its end', () => {
    const until = '2026-08-20T12:00:00Z';
    expect(sanctionState({ suspended_until: until, banned_at: null }, NOW)).toEqual({
      kind: 'suspended',
      until,
    });
  });

  it('a past suspended_until is a lapsed suspension — no banner, matching is_active()', () => {
    expect(
      sanctionState({ suspended_until: '2026-08-01T12:00:00Z', banned_at: null }, NOW),
    ).toBeNull();
  });

  it('the boundary instant is not a sanction — strictly greater than now, like is_active()', () => {
    expect(sanctionState({ suspended_until: '2026-08-13T12:00:00Z', banned_at: null }, NOW)).toBe(
      null,
    );
  });

  it('banned_at outranks a concurrent suspension window', () => {
    expect(
      sanctionState(
        { suspended_until: '2026-08-20T12:00:00Z', banned_at: '2026-08-10T09:00:00Z' },
        NOW,
      ),
    ).toEqual({ kind: 'banned' });
  });

  // #735 — the member asked to be erased and the request is still open. The erasure ban lives on
  // auth.users, not on the profile, so without this input a second device reads «good standing»
  // and every write fails with a bare 42501.
  it('an open erasure request is its own state, whatever the profile says', () => {
    expect(sanctionState({ suspended_until: null, banned_at: null }, NOW, true)).toEqual({
      kind: 'erasing',
    });
  });

  it('erasing outranks a ban — the member left, the account is going', () => {
    expect(
      sanctionState(
        { suspended_until: '2026-08-20T12:00:00Z', banned_at: '2026-08-10T09:00:00Z' },
        NOW,
        true,
      ),
    ).toEqual({ kind: 'erasing' });
  });

  it('no open request leaves the existing states untouched', () => {
    expect(sanctionState({ suspended_until: null, banned_at: null }, NOW, false)).toBeNull();
    expect(sanctionState({ banned_at: '2026-08-10T09:00:00Z' }, NOW, false)).toEqual({
      kind: 'banned',
    });
  });

  it('no profile is still no sanction, even with an open request', () => {
    expect(sanctionState(null, NOW, true)).toBeNull();
  });
});
