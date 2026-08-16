import { describe, expect, it } from 'vitest';
import { payableCents, remainingPayableCents } from './payable';

describe('payableCents', () => {
  it('is the pool less the declared retention', () => {
    expect(payableCents(50000, 10)).toBe(45000);
  });

  it('is the whole pool when nothing is retained', () => {
    expect(payableCents(50000, 0)).toBe(50000);
  });

  it('is zero when everything is retained', () => {
    expect(payableCents(50000, 100)).toBe(0);
  });

  it('is zero for an empty pool', () => {
    expect(payableCents(0, 10)).toBe(0);
  });

  // The DB computes (pool * (100 - split)) / 100 in integer arithmetic, which TRUNCATES.
  // 999 * 90 / 100 = 899.1 → 899. Rounding here instead would put the screen one cent above
  // a ceiling the trigger refuses, which is the exact defect this function exists to avoid.
  it('truncates the fractional cent, matching the database exactly', () => {
    expect(payableCents(999, 10)).toBe(899);
    expect(payableCents(1999, 10)).toBe(1799);
    expect(payableCents(101, 50)).toBe(50);
  });

  it('never exceeds the pool it is derived from', () => {
    for (const split of [0, 1, 7, 33, 99, 100]) {
      expect(payableCents(12345, split)).toBeLessThanOrEqual(12345);
    }
  });
});

describe('remainingPayableCents', () => {
  it('is what is left of the payable after the costed phases', () => {
    expect(remainingPayableCents(50000, 10, 20000)).toBe(25000);
  });

  it('is the whole payable when nothing is costed yet', () => {
    expect(remainingPayableCents(50000, 10, 0)).toBe(45000);
  });

  it('is zero when the phases cost exactly the payable', () => {
    expect(remainingPayableCents(50000, 10, 45000)).toBe(0);
  });

  // A plan costed past the ceiling cannot exist in the database (the within-payable trigger
  // refuses it), but a screen reading a stale sum must not render a negative euro figure —
  // it clamps, and the refusal is what tells the member, not a minus sign.
  it('clamps at zero rather than reporting a negative remainder', () => {
    expect(remainingPayableCents(50000, 10, 45001)).toBe(0);
    expect(remainingPayableCents(50000, 10, 900000)).toBe(0);
  });

  it('truncates the fractional cent exactly as payableCents does', () => {
    expect(remainingPayableCents(999, 10, 99)).toBe(800);
  });
});
