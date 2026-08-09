import { describe, expect, it } from 'vitest';
import { MIN_CONTRIBUTION_CENTS, parseEuroToCents } from './amount';

describe('parseEuroToCents', () => {
  it('whole euros → cents', () => {
    expect(parseEuroToCents(1)).toBe(100);
    expect(parseEuroToCents(25)).toBe(2500);
    expect(parseEuroToCents('10')).toBe(1000);
  });
  it('two-decimal amounts (dot and it-IT comma)', () => {
    expect(parseEuroToCents('5.50')).toBe(550);
    expect(parseEuroToCents('5,50')).toBe(550);
    expect(parseEuroToCents('1,99')).toBe(199);
  });
  it('rejects below the €1 minimum', () => {
    expect(parseEuroToCents('0.99')).toBeNull();
    expect(parseEuroToCents(0)).toBeNull();
    expect(parseEuroToCents(-5)).toBeNull();
  });
  it('rejects junk / blank / >2 decimals', () => {
    expect(parseEuroToCents('')).toBeNull();
    expect(parseEuroToCents('abc')).toBeNull();
    expect(parseEuroToCents('1.234')).toBeNull();
    expect(parseEuroToCents(Number.NaN)).toBeNull();
  });
  // Every string case above is already trimmed, so dropping `.trim()` changed nothing. A user
  // typing into a numeric field routinely leaves a trailing space, and untrimmed input fails
  // the regex — the amount would silently read as invalid.
  it('trims surrounding whitespace before parsing', () => {
    expect(parseEuroToCents(' 5 ')).toBe(500);
    expect(parseEuroToCents('\t12,50\n')).toBe(1250);
  });
  it('MIN_CONTRIBUTION_CENTS is €1', () => {
    expect(MIN_CONTRIBUTION_CENTS).toBe(100);
  });
});
