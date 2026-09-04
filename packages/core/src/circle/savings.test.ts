import { describe, expect, it } from 'vitest';
import { MONTHS_PER_YEAR, circleAnnualSavings } from './savings';

/**
 * #644: the savings line under the Circle price toggle used to be a catalog literal
 * («Risparmi €45 all'anno»). It is now DERIVED from the two live Stripe amounts, so this
 * is the only place the claim exists — and the only place it can be wrong.
 */
describe('circleAnnualSavings', () => {
  it('returns what a year on the annual plan saves against twelve monthly charges', () => {
    // The live sandbox Prices on 2026-09-03: €12,00/month and €99,00/year.
    expect(
      circleAnnualSavings(
        { unitAmount: 1200, currency: 'eur' },
        { unitAmount: 9900, currency: 'eur' },
      ),
    ).toEqual({
      cents: 4500,
      currency: 'eur',
    });
  });

  it('counts twelve monthly charges, not some other number of them', () => {
    expect(MONTHS_PER_YEAR).toBe(12);
    expect(
      circleAnnualSavings({ unitAmount: 100, currency: 'eur' }, { unitAmount: 0, currency: 'eur' }),
    ).toEqual({ cents: 1200, currency: 'eur' });
  });

  it('claims nothing when the annual plan costs exactly twelve months', () => {
    expect(
      circleAnnualSavings(
        { unitAmount: 1000, currency: 'eur' },
        { unitAmount: 12000, currency: 'eur' },
      ),
    ).toBeNull();
  });

  it('claims nothing when the annual plan is the dearer of the two', () => {
    expect(
      circleAnnualSavings(
        { unitAmount: 1000, currency: 'eur' },
        { unitAmount: 13000, currency: 'eur' },
      ),
    ).toBeNull();
  });

  it('claims nothing when the two plans are priced in different currencies', () => {
    // A misconfigured pair of Price ids: subtracting across currencies is not a saving,
    // it is a number with no meaning. Better no line than a false one (#644).
    expect(
      circleAnnualSavings(
        { unitAmount: 1200, currency: 'eur' },
        { unitAmount: 9900, currency: 'usd' },
      ),
    ).toBeNull();
  });

  it('carries the plans’ own currency, so the line is formatted in what is charged', () => {
    expect(
      circleAnnualSavings(
        { unitAmount: 1200, currency: 'chf' },
        { unitAmount: 9900, currency: 'chf' },
      ),
    ).toEqual({ cents: 4500, currency: 'chf' });
  });
});
