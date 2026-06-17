import { describe, expect, it } from 'vitest';
import { formatFundTotal, FUND_SPLIT } from './format';

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
});

describe('FUND_SPLIT', () => {
  it('is the fixed 90/10 split (PRD §4.11)', () => {
    expect(FUND_SPLIT.dreamPct).toBe(90);
    expect(FUND_SPLIT.opsPct).toBe(10);
    expect(FUND_SPLIT.dreamPct + FUND_SPLIT.opsPct).toBe(100);
  });
});
