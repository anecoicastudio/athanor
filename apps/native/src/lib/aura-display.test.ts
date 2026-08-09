import { describe, expect, it } from 'vitest';
import { AURA_UNKNOWN, auraDisplayValue } from './aura-display';

describe('auraDisplayValue', () => {
  it('renders a real score as its digits', () => {
    expect(auraDisplayValue(0, false)).toBe('0');
    expect(auraDisplayValue(482, false)).toBe('482');
  });

  // The bug this module exists for: a failed read used to coalesce to 0, which on an
  // earned-only reputation reads as "this person has contributed nothing" rather than
  // "we could not check".
  it('renders a failed read as unknown, never as zero', () => {
    expect(auraDisplayValue(undefined, true)).toBe(AURA_UNKNOWN);
    expect(auraDisplayValue(null, true)).toBe(AURA_UNKNOWN);
  });

  // isError wins even when a score is present: a stale value from a previous query with a
  // failing refetch is still a value we cannot vouch for.
  it('prefers unknown over a stale score when the read is failing', () => {
    expect(auraDisplayValue(482, true)).toBe(AURA_UNKNOWN);
  });

  // A settled-but-absent score (no row yet) is also unknown, not zero — the score engine
  // writes the row, so its absence means "not computed", not "computed as nothing".
  it('treats an absent score as unknown even without an error', () => {
    expect(auraDisplayValue(undefined, false)).toBe(AURA_UNKNOWN);
    expect(auraDisplayValue(null, false)).toBe(AURA_UNKNOWN);
  });

  // Zero is a legitimate score and must survive: a brand-new member really has earned nothing,
  // and that is different from a failure. Guards against "fix" the falsy check `score || '--'`.
  it('keeps a genuine zero distinguishable from unknown', () => {
    expect(auraDisplayValue(0, false)).not.toBe(AURA_UNKNOWN);
  });
});
