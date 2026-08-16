import { describe, expect, it } from 'vitest';
import { formatEuroAmount, formatFundTotal } from './format';

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

/**
 * The ticker truncates to whole euros; a PAYMENT figure must not (#236). The optional fee
 * coverage is €0,27 on a €1 gift — truncated it reads «0», which is a lie on the one screen
 * where the number is the consent.
 */
describe('formatEuroAmount', () => {
  it('keeps the cents, with the it-IT decimal comma', () => {
    expect(formatEuroAmount(127, 'it')).toBe('1,27');
  });
  it('keeps the cents, with the en decimal point', () => {
    expect(formatEuroAmount(127, 'en')).toBe('1.27');
  });
  it('shows a whole amount to two decimals anyway — money is never «10»', () => {
    expect(formatEuroAmount(1000, 'it')).toBe('10,00');
    expect(formatEuroAmount(1000, 'en')).toBe('10.00');
  });
  it('renders sub-euro amounts, the case truncation destroys', () => {
    expect(formatEuroAmount(27, 'it')).toBe('0,27');
    expect(formatEuroAmount(27, 'en')).toBe('0.27');
  });
  it('groups thousands the way each locale does', () => {
    expect(formatEuroAmount(123456, 'it')).toBe('1.234,56');
    expect(formatEuroAmount(123456, 'en')).toBe('1,234.56');
  });
});
