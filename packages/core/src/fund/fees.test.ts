import { describe, expect, it } from 'vitest';
import { STRIPE_FEE_BPS, STRIPE_FEE_FIXED_CENTS, feeCoverage, type FeeCoverage } from './fees';

/**
 * FUND-51 / #236 — the optional fee coverage and its recursive gross-up.
 *
 * The whole point of the formula is that a NAIVE addition is wrong: adding
 * `gift * 1.5% + €0.25` and charging that leaves the fund short, because Stripe
 * takes its percentage of the LARGER, grossed-up amount too. On a €1 gift the naive
 * sum is €0,265 → €1,27 charged only by luck of rounding; on larger gifts the gap
 * compounds. The correct charge solves `charged - fee(charged) >= gift`, i.e.
 * `charged = ceil((gift + fixed) / (1 - pct))`.
 *
 * `stripeFeeOn` below models Stripe's own deduction so the tests can assert the
 * property that actually matters — THE FUND IS NEVER SHORT — rather than trusting
 * the formula's shape.
 */
const stripeFeeOn = (chargedCents: number): number =>
  Math.round((chargedCents * STRIPE_FEE_BPS) / 10_000) + STRIPE_FEE_FIXED_CENTS;

describe('the published Stripe rate constants (rule #10)', () => {
  it('is 1.5% + €0,25, the EU standard-card rate the disclosure quotes', () => {
    expect(STRIPE_FEE_BPS).toBe(150);
    expect(STRIPE_FEE_FIXED_CENTS).toBe(25);
  });
});

describe('feeCoverage — the recursive gross-up', () => {
  it('turns a €1,00 gift into €1,27 charged, €0,27 of coverage (the figure #236 quotes)', () => {
    expect(feeCoverage(100)).toEqual<FeeCoverage>({
      giftCents: 100,
      coverageCents: 27,
      chargedCents: 127,
    });
  });

  it('lands exactly when the division is exact — €9,60 gift → €10,00 charged', () => {
    // 985 / 0.985 = 1000 with no remainder, so nothing is rounded up here and the
    // fund receives the gift to the cent: 1000 - (15 + 25) = 960.
    expect(feeCoverage(960)).toEqual<FeeCoverage>({
      giftCents: 960,
      coverageCents: 40,
      chargedCents: 1000,
    });
    expect(1000 - stripeFeeOn(1000)).toBe(960);
  });

  it('rounds the charge UP, never to nearest — a €2,38 gift charges €2,68, not €2,67', () => {
    // (238 + 25) / 0.985 = 267.005…  Nearest-cent would charge 267 and leave the fund
    // with exactly the gift only because Stripe happens to round its own fee down —
    // a coincidence, not a guarantee. Rounding up is the only version that cannot
    // hand Stripe the rounding decision.
    expect(feeCoverage(238)).toEqual<FeeCoverage>({
      giftCents: 238,
      coverageCents: 30,
      chargedCents: 268,
    });
  });

  it('never leaves the fund short, across the whole plausible range', () => {
    // The property the formula exists for. A naive `gift + fee(gift)` charge fails this.
    for (let gift = 100; gift <= 100_000; gift += 7) {
      const { chargedCents } = feeCoverage(gift);
      expect(chargedCents - stripeFeeOn(chargedCents)).toBeGreaterThanOrEqual(gift);
    }
  });

  it('never overshoots by more than a cent — the coverage is a cost, not a margin', () => {
    // Bounds the formula from ABOVE too: charging more than the fee plus one cent of
    // rounding would make the coverage a hidden donation the payer did not consent to.
    for (let gift = 100; gift <= 100_000; gift += 7) {
      const { chargedCents } = feeCoverage(gift);
      expect(chargedCents - stripeFeeOn(chargedCents)).toBeLessThanOrEqual(gift + 1);
    }
  });

  it('always keeps the split self-consistent', () => {
    for (const gift of [100, 101, 238, 500, 960, 2500, 99_999]) {
      const split = feeCoverage(gift);
      expect(split.giftCents + split.coverageCents).toBe(split.chargedCents);
      expect(split.coverageCents).toBeGreaterThan(0);
      expect(Number.isInteger(split.coverageCents)).toBe(true);
    }
  });

  it('refuses anything the €1 floor would refuse', () => {
    // The floor is on the GIFT, never on the charge: coverage may not be used to
    // sneak a sub-€1 contribution over the line. The message is asserted, not just the
    // class — a thrown RangeError with no message is indistinguishable from a bug.
    for (const under of [99, 0, -100]) {
      expect(() => feeCoverage(under)).toThrow(RangeError);
      expect(() => feeCoverage(under)).toThrow(/at least 100 cents/);
    }
  });

  it('refuses non-integer minor units', () => {
    for (const bad of [100.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => feeCoverage(bad)).toThrow(RangeError);
      expect(() => feeCoverage(bad)).toThrow(/integer/);
    }
  });
});
