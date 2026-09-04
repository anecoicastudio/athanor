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
});
