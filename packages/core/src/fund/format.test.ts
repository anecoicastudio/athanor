import { describe, expect, it } from 'vitest';
import { formatFundTotal } from './format';

describe('formatFundTotal', () => {
  it('formats whole euros with it-IT grouping (dot thousands)', () => {
    expect(formatFundTotal(48328100, 'it')).toBe('€ 483.281');
  });
  it('formats whole euros with en grouping (comma thousands)', () => {
    expect(formatFundTotal(48328100, 'en')).toBe('€ 483,281');
  });
  it('drops the cents remainder (ticker shows whole euros)', () => {
    expect(formatFundTotal(199, 'it')).toBe('€ 1');
  });
  it('renders zero', () => {
    expect(formatFundTotal(0, 'it')).toBe('€ 0');
  });
  // Exactly four digits is where the explicit `useGrouping: true` earns its keep: Intl's default
  // is "auto", which in it-IT leaves a 4-digit number ungrouped («1000»), while "always" gives
  // «1.000». Every other amount tested here is 1–6 digits where the two agree, so dropping the
  // options object entirely went unnoticed — and the ticker crossing €1.000 is exactly the
  // moment someone is looking at it.
  // en-GB groups at four digits under "auto" too, so only the it-IT line separates the two
  // settings; the en line is symmetry, not a second guard.
  it('groups at four digits, where it-IT Intl would not by default', () => {
    expect(formatFundTotal(100000, 'it')).toBe('€ 1.000');
    expect(formatFundTotal(100000, 'en')).toBe('€ 1,000');
  });
});
