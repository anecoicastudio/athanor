import { describe, expect, it } from 'vitest';
import { parsePriceCents } from './price';

describe('parsePriceCents — whole euros', () => {
  it('converts euros to cents', () => {
    expect(parsePriceCents('10')).toBe(1000);
    expect(parsePriceCents('1')).toBe(100);
    expect(parsePriceCents('0')).toBe(0);
  });

  it('handles surrounding whitespace the way Number does', () => {
    expect(parsePriceCents(' 10 ')).toBe(1000);
  });
});

describe('parsePriceCents — the it-IT decimal comma', () => {
  it('a comma is read as a decimal separator', () => {
    expect(parsePriceCents('12,50')).toBe(1250);
    expect(parsePriceCents('0,99')).toBe(99);
  });

  it('a dot works identically', () => {
    expect(parsePriceCents('12.50')).toBe(1250);
    expect(parsePriceCents('0.99')).toBe(99);
  });

  it('comma and dot agree for the same amount', () => {
    expect(parsePriceCents('7,35')).toBe(parsePriceCents('7.35'));
  });

  it('rounds away binary float error rather than truncating', () => {
    expect(parsePriceCents('1,10')).toBe(110);
    expect(parsePriceCents('4,20')).toBe(420);
    expect(parsePriceCents('19,99')).toBe(1999);
  });

  it('rejects a third decimal rather than silently absorbing it', () => {
    expect(parsePriceCents('1,005')).toBeNull();
  });

  it('composes cents from the digits, so no half-cent is lost to binary float', () => {
    // 1.005 * 100 is 100.4999… and 2.675 * 100 is 267.49999… — Math.round on either drops a
    // cent in one direction and not the other, which is why the digits are read directly.
    expect(parsePriceCents('1,00')).toBe(100);
    expect(parsePriceCents('2,67')).toBe(267);
    expect(parsePriceCents('8,16')).toBe(816);
  });
});

describe('parsePriceCents — malformed input is rejected, never coerced', () => {
  it('rejects letters and currency symbols', () => {
    expect(parsePriceCents('abc')).toBeNull();
    expect(parsePriceCents('€10')).toBeNull();
    expect(parsePriceCents('10 euro')).toBeNull();
  });

  it('rejects a thousands separator rather than misreading it', () => {
    // `replace` rewrites only the first separator, so this used to reach Number as '1.000,00'.
    expect(parsePriceCents('1.000,00')).toBeNull();
    expect(parsePriceCents('1,000,00')).toBeNull();
  });

  it('rejects an empty or blank field instead of charging zero', () => {
    expect(parsePriceCents('')).toBeNull();
    expect(parsePriceCents('   ')).toBeNull();
  });

  it('rejects a negative amount', () => {
    expect(parsePriceCents('-5')).toBeNull();
  });

  it('rejects scientific notation — 1e3 must never read as a thousand euro', () => {
    expect(parsePriceCents('1e3')).toBeNull();
    expect(parsePriceCents('Infinity')).toBeNull();
  });
});
